const { createClient } = require('webdav');
const data = require('../data.js');
const db = require('../database.js');

let clients = {};

function getClient(userId) {
    const storageManager = require('./index'); 
    const config = storageManager.readConfig();
    const userWebdavConfig = config.webdav.find(c => c.userId === userId);
    if (!userWebdavConfig) {
        throw new Error('找不到該使用者的 WebDAV 設定');
    }

    const clientKey = `${userId}-${userWebdavConfig.url}-${userWebdavConfig.username}`;
    if (!clients[clientKey]) {
        clients[clientKey] = createClient(userWebdavConfig.url, {
            username: userWebdavConfig.username,
            password: userWebdavConfig.password
        });
    }
    return clients[clientKey];
}

async function getFolderPath(folderId, userId) {
    const userRoot = await new Promise((resolve, reject) => {
        db.get("SELECT id FROM folders WHERE user_id = ? AND parent_id IS NULL", [userId], (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('找不到使用者根目錄'));
            resolve(row);
        });
    });

    if (folderId === userRoot.id) return '/';
    
    const pathParts = await data.getFolderPath(folderId, userId);
    return '/' + pathParts.slice(1).map(p => p.name).join('/');
}

async function upload(fileBuffer, fileName, mimetype, userId, folderId) {
    const client = getClient(userId);
    const folderPath = await getFolderPath(folderId, userId);
    const remotePath = (folderPath === '/' ? '' : folderPath) + '/' + fileName;
    
    // 解決資料夾上傳問題：確保遠端目錄存在
    if (folderPath && folderPath !== "/") {
        try {
            await client.createDirectory(folderPath, { recursive: true });
        } catch (e) {
            // 忽略目錄已存在的錯誤
            if (e.response && (e.response.status !== 405 && e.response.status !== 501)) {
                 throw e;
            }
        }
    }

    const success = await client.putFileContents(remotePath, fileBuffer, { overwrite: true });

    if (!success) {
        throw new Error('WebDAV putFileContents 操作失敗');
    }

    const stat = await client.stat(remotePath);
    const messageId = Date.now() + Math.floor(Math.random() * 1000);

    const dbResult = await data.addFile({
        message_id: messageId,
        fileName,
        mimetype,
        size: stat.size,
        file_id: remotePath,
        date: new Date(stat.lastmod).getTime(),
    }, folderId, userId, 'webdav');
    
    return { success: true, message: '檔案已上傳至 WebDAV。', fileId: dbResult.fileId };
}

async function remove(files, userId) {
    const client = getClient(userId);
    for (const file of files) {
        try {
            await client.deleteFile(file.file_id);
        } catch (error) {
            if (error.response && error.response.status !== 404) {
                 console.warn(`刪除 WebDAV 檔案失敗: ${file.file_id}`, error.message);
            }
        }
    }
    await data.deleteFilesByIds(files.map(f => f.message_id), userId);
    return { success: true };
}

// 解決下載和分享問題：新增 stream 方法
async function stream(file_id, userId) {
    const client = getClient(userId);
    return client.createReadStream(file_id);
}

// getUrl 保持不變，但優先使用 stream
async function getUrl(file_id, userId) {
    const client = getClient(userId);
    return client.getFileDownloadLink(file_id);
}

module.exports = { upload, remove, getUrl, stream, type: 'webdav' };
