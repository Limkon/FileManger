const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const data = require('../data.js');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');

async function setup() {
    try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
    } catch (e) {
        console.error("无法建立上传目录:", e);
    }
}
setup();

async function removeEmptyDirs(directoryPath) {
    try {
        if (!directoryPath.startsWith(UPLOAD_DIR)) return;

        let currentPath = directoryPath;
        while (currentPath !== UPLOAD_DIR && currentPath !== path.dirname(UPLOAD_DIR)) {
            const files = await fs.readdir(currentPath);
            if (files.length === 0) {
                await fs.rmdir(currentPath);
                currentPath = path.dirname(currentPath);
            } else {
                break;
            }
        }
    } catch (error) {
        console.warn(`清理空目录失败: ${directoryPath}`, error.message);
    }
}


async function upload(tempFilePath, fileName, mimetype, userId, folderId) {
    const userDir = path.join(UPLOAD_DIR, String(userId));
    await fs.mkdir(userDir, { recursive: true });

    const uniqueId = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const finalFilePath = path.join(userDir, uniqueId);

    // 使用流式传输复制文件
    await new Promise((resolve, reject) => {
        const readStream = fsSync.createReadStream(tempFilePath);
        const writeStream = fsSync.createWriteStream(finalFilePath);
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        readStream.pipe(writeStream);
    });
    
    const stats = await fs.stat(finalFilePath);

    const messageId = BigInt(Date.now()) * 1000000n + BigInt(crypto.randomInt(1000000));

    const dbResult = await data.addFile({
        message_id: messageId,
        fileName,
        mimetype,
        size: stats.size,
        file_id: finalFilePath,
        thumb_file_id: null,
        date: Date.now(),
    }, folderId, userId, 'local');

    return { success: true, message: '文件已储存至本地。', fileId: dbResult.fileId };
}

async function remove(files, userId) {
    const filePaths = files.map(f => f.file_id);
    const messageIds = files.map(f => f.message_id);
    const parentDirs = new Set();

    for (const filePath of filePaths) {
        try {
            if(fsSync.existsSync(filePath)) {
                parentDirs.add(path.dirname(filePath));
                await fs.unlink(filePath);
            }
        } catch (e) {
            console.warn(`删除本地文件失败: ${filePath}`, e.message);
        }
    }
    await data.deleteFilesByIds(messageIds, userId);

    for (const dir of parentDirs) {
        await removeEmptyDirs(dir);
    }
    
    return { success: true };
}

async function getUrl(file_id, userId) {
    return `/local-files/${userId}/${path.basename(file_id)}`;
}

module.exports = { upload, remove, getUrl, type: 'local' };
