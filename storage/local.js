const fs = require('fs').promises;
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

async function upload(fileBuffer, fileName, mimetype, userId, folderId) {
    const userDir = path.join(UPLOAD_DIR, String(userId));
    await fs.mkdir(userDir, { recursive: true });

    const uniqueId = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const filePath = path.join(userDir, uniqueId);

    await fs.writeFile(filePath, fileBuffer);

    const messageId = Date.now() + Math.floor(Math.random() * 1000);

    const dbResult = await data.addFile({
        message_id: messageId,
        fileName,
        mimetype,
        size: fileBuffer.length,
        file_id: filePath,
        thumb_file_id: null,
        date: Date.now(),
    }, folderId, userId, 'local');

    return { success: true, message: '档案已储存至本地。', fileId: dbResult.fileId };
}

async function remove(files, userId) {
    const filePaths = files.map(f => f.file_id);
    const messageIds = files.map(f => f.message_id);

    for (const filePath of filePaths) {
        try {
            await fs.unlink(filePath);
        } catch (e) {
            console.warn(`删除本地档案失败: ${filePath}`, e.message);
        }
    }
    await data.deleteFilesByIds(messageIds, userId);
    return { success: true };
}

async function getUrl(file_id, userId) {
    return `/local-files/${userId}/${path.basename(file_id)}`;
}

module.exports = { upload, remove, getUrl, type: 'local' };
