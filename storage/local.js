const fs = require('fs');
const path = require('path');
const data = require('../data.js');

const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');

async function upload(readStream, fileName, mimetype, userId, folderId, size) {
    const userUploadsDir = path.join(UPLOADS_DIR, String(userId));
    if (!fs.existsSync(userUploadsDir)) {
        fs.mkdirSync(userUploadsDir, { recursive: true });
    }

    // 使用 message_id 作為檔名以確保唯一性
    const messageId = Date.now() + Math.floor(Math.random() * 1000);
    const finalFilePath = path.join(userUploadsDir, String(messageId));
    
    // 核心重構：使用 pipe 進行流式寫入
    const writeStream = fs.createWriteStream(finalFilePath);
    
    await new Promise((resolve, reject) => {
        readStream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        readStream.on('error', reject); // 確保也能捕捉讀取流的錯誤
    });

    const dbResult = await data.addFile({
        message_id: messageId,
        fileName,
        mimetype,
        size,
        file_id: finalFilePath, // 儲存最終路徑
        date: Date.now(),
    }, folderId, userId, 'local');

    return { success: true, message: '檔案已上傳至本地。', fileId: dbResult.fileId };
}

async function remove(files, userId) {
    for (const file of files) {
        try {
            if (fs.existsSync(file.file_id)) {
                fs.unlinkSync(file.file_id);
            }
        } catch (error) {
            console.warn(`刪除本地檔案失敗: ${file.file_id}`, error.message);
        }
    }
    await data.deleteFilesByIds(files.map(f => f.message_id), userId);
    return { success: true };
}

async function stream(file_id, userId) {
    return fs.createReadStream(file_id);
}

module.exports = { upload, remove, stream, type: 'local' };
