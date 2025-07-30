const { createClient } = require('webdav');
const data = require('../data.js');
const db = require('../database.js');
const crypto = require('crypto');
const fsp = require('fs').promises;
const path = require('path');

// 这个 client 将只用于写入和删除等非流式操作
let client = null;

// 封装一个获取配置的函数，避免重复代码
function getWebdavConfig() {
    const storageManager = require('./index'); 
    const config = storageManager.readConfig();
    const webdavConfig = config.webdav && Array.isArray(config.webdav) ? config.webdav[0] : config.webdav;
    if (!webdavConfig || !webdavConfig.url) {
        throw new Error('WebDAV 设定不完整或未设定');
    }
    return webdavConfig;
}


function getClient() {
    if (!client) {
        const webdavConfig = getWebdavConfig();
        client = createClient(webdavConfig.url, {
            username: webdavConfig.username,
            password: webdavConfig.password
        });
    }
    return client;
}

function resetClient() {
    client = null;
}

async function getFolderPath(folderId, userId) {
    const userRoot = await new Promise((resolve, reject) => {
        db.get("SELECT id FROM folders WHERE user_id = ? AND parent_id IS NULL", [userId], (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('找不到使用者根目录'));
            resolve(row);
        });
    });

    if (folderId === userRoot.id) return '/';
    
    const pathParts = await data.getFolderPath(folderId, userId);
    return '/' + pathParts.slice(1).map(p => p.name).join('/');
}

async function upload(tempFilePath, fileName, mimetype, userId, folderId) {
    const client = getClient();
    const folderPath = await getFolderPath(folderId, userId);
    const remotePath = (folderPath === '/' ? '' : folderPath) + '/' + fileName;
    
    if (folderPath && folderPath !== "/") {
        try {
            await client.createDirectory(folderPath, { recursive: true });
        } catch (e) {
            if (e.response && (e.response.status !== 405 && e.response.status !== 501)) {
                 throw new Error(`建立 WebDAV 目录失败 (${e.response.status}): ${e.message}`);
            }
        }
    }

    const fileBuffer = await fsp.readFile(tempFilePath);
    const success = await client.putFileContents(remotePath, fileBuffer, { overwrite: true });

    if (!success) {
        throw new Error('WebDAV putFileContents 操作失败');
    }

    const stat = await client.stat(remotePath);
    const messageId = BigInt(Date.now()) * 1000000n + BigInt(crypto.randomInt(1000000));

    const dbResult = await data.addFile({
        message_id: messageId,
        fileName,
        mimetype,
        size: stat.size,
        file_id: remotePath,
        date: new Date(stat.lastmod).getTime(),
    }, folderId, userId, 'webdav');
    
    return { success: true, message: '档案已上传至 WebDAV。', fileId: dbResult.fileId };
}


async function remove(files, folders, userId) {
    const client = getClient();
    const results = { success: true, errors: [] };

    // 1. 创建统一的待删除项目列表
    const allItemsToDelete = [];
    
    files.forEach(file => {
        let p = file.file_id.startsWith('/') ? file.file_id : '/' + file.file_id;
        allItemsToDelete.push({ 
            path: path.posix.normalize(p), 
            type: 'file' 
        });
    });
    
    folders.forEach(folder => {
        if (folder.path && folder.path !== '/') {
            let p = folder.path.startsWith('/') ? folder.path : '/' + folder.path;
            if (!p.endsWith('/')) {
                p += '/';
            }
            allItemsToDelete.push({ path: p, type: 'folder' });
        }
    });

    // 2. 按路径深度降序排序，确保先删除子项
    allItemsToDelete.sort((a, b) => b.path.length - a.path.length);

    // 3. 依次执行删除
    for (const item of allItemsToDelete) {
        try {
            // **最终勘误**：无论是档案还是资料夹，都统一使用 `deleteFile` 函数。
            // WebDAV 服务器会根据路径是否以 '/' 结尾来区分档案和资料夹。
            await client.deleteFile(item.path);
        } catch (error) {
            if (!(error.response && error.response.status === 404)) {
                const errorMessage = `删除 WebDAV ${item.type} [${item.path}] 失败: ${error.message}`;
                console.error(errorMessage);
                results.errors.push(errorMessage);
                results.success = false;
            }
        }
    }

    return results;
}

// 为每个流操作创建一个完全独立的客户端实例，以解决文件锁问题
async function stream(file_id, userId) {
    const webdavConfig = getWebdavConfig();
    const streamClient = createClient(webdavConfig.url, {
        username: webdavConfig.username,
        password: webdavConfig.password
    });
    return streamClient.createReadStream(path.posix.join('/', file_id));
}

async function getUrl(file_id, userId) {
    const client = getClient();
    return client.getFileDownloadLink(path.posix.join('/', file_id));
}

module.exports = { upload, remove, getUrl, stream, resetClient, type: 'webdav' };
