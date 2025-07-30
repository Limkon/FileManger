require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const bcrypt = require('bcrypt');
const fs = require('fs');
const fsp = require('fs').promises;
const crypto = require('crypto');
const db = require('./database.js'); 

const data = require('./data.js');
const storageManager = require('./storage'); 

const app = express();

// --- 临时文件目录设定与清理 ---
const TMP_DIR = path.join(__dirname, 'data', 'tmp');

// 封装一个健壮的清理函数
async function cleanupTempDir() {
    try {
        if (!fs.existsSync(TMP_DIR)) {
            await fsp.mkdir(TMP_DIR, { recursive: true });
            return;
        }
        const files = await fsp.readdir(TMP_DIR);
        for (const file of files) {
            try {
                await fsp.unlink(path.join(TMP_DIR, file));
            } catch (err) {
                // 忽略已经不存在的文件等小错误
                console.warn(`清理临时文件时发生非致命错误: ${file}`, err.message);
            }
        }
    } catch (error) {
        console.error(`[严重错误] 清理暂存目录失败: ${TMP_DIR}。`, error);
    }
}

// 启动时清理一次
cleanupTempDir();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TMP_DIR)
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 1000 * 1024 * 1024 } });
const PORT = process.env.PORT || 8100;

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-strong-random-secret-here-please-change',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- 中介软体 ---
const fixFileNameEncoding = (req, res, next) => {
    if (req.files) {
        req.files.forEach(file => {
            file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        });
    }
    next();
};

function requireLogin(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
    if (req.session.loggedIn && req.session.isAdmin) {
        return next();
    }
    res.status(403).send('权限不足');
}

// --- 路由 ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views/register.html')));
app.get('/editor', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/editor.html')));

app.post('/login', async (req, res) => {
    try {
        const user = await data.findUserByName(req.body.username);
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            req.session.loggedIn = true;
            req.session.userId = user.id;
            req.session.isAdmin = !!user.is_admin;
            res.redirect('/');
        } else {
            res.status(401).send('帐号或密码错误');
        }
    } catch(error) {
        res.status(500).send('登入时发生错误');
    }
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('请提供使用者名称和密码');
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = await data.createUser(username, hashedPassword); 
        await data.createFolder('/', null, newUser.id); 
        res.redirect('/login');
    } catch (error) {
        res.status(500).send('注册失败，使用者名称可能已被使用。');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/');
        }
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

app.get('/', requireLogin, (req, res) => {
    db.get("SELECT id FROM folders WHERE user_id = ? AND parent_id IS NULL", [req.session.userId], (err, rootFolder) => {
        if (err || !rootFolder) {
            return res.status(500).send("找不到您的根目录");
        }
        res.redirect(`/folder/${rootFolder.id}`);
    });
});
app.get('/folder/:id', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/manager.html')));
app.get('/shares-page', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/shares.html')));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'views/admin.html')));

// --- 新生：扫描页面路由 ---
app.get('/scan', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'views/scan.html')));

app.get('/local-files/:userId/:fileId', requireLogin, (req, res) => {
    if (String(req.params.userId) !== String(req.session.userId) && !req.session.isAdmin) {
        return res.status(403).send("权限不足");
    }
    const filePath = path.join(__dirname, 'data', 'uploads', req.params.userId, req.params.fileId);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("档案不存在");
    }
});


// --- API 接口 ---
app.post('/api/user/change-password', requireLogin, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    
    if (!oldPassword || !newPassword || newPassword.length < 4) {
        return res.status(400).json({ success: false, message: '请提供旧密码和新密码，且新密码长度至少 4 个字符。' });
    }
    try {
        const user = await data.findUserById(req.session.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '找不到使用者。' });
        }

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: '旧密码不正确。' });
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        await data.changeUserPassword(req.session.userId, hashedPassword);
        
        res.json({ success: true, message: '密码修改成功。' });
    } catch (error) {
        res.status(500).json({ success: false, message: '修改密码失败。' });
    }
});

app.get('/api/admin/storage-mode', requireAdmin, (req, res) => {
    res.json({ mode: storageManager.readConfig().storageMode });
});

app.post('/api/admin/storage-mode', requireAdmin, (req, res) => {
    const { mode } = req.body;
    if (storageManager.setStorageMode(mode)) {
        res.json({ success: true, message: '设定已储存。' });
    } else {
        res.status(400).json({ success: false, message: '无效的模式' });
    }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const users = await data.listNormalUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ success: false, message: '获取使用者列表失败。' });
    }
});

app.get('/api/admin/all-users', requireAdmin, async (req, res) => {
    try {
        const users = await data.listAllUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ success: false, message: '获取所有使用者列表失败。' });
    }
});


app.post('/api/admin/add-user', requireAdmin, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) {
        return res.status(400).json({ success: false, message: '使用者名称和密码为必填项，且密码长度至少 4 个字符。' });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = await data.createUser(username, hashedPassword);
        await data.createFolder('/', null, newUser.id);
        res.json({ success: true, user: newUser });
    } catch (error) {
        res.status(500).json({ success: false, message: '建立使用者失败，可能使用者名称已被使用。' });
    }
});

app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword || newPassword.length < 4) {
        return res.status(400).json({ success: false, message: '使用者 ID 和新密码为必填项，且密码长度至少 4 个字符。' });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        await data.changeUserPassword(userId, hashedPassword);
        res.json({ success: true, message: '密码修改成功。' });
    } catch (error) {
        res.status(500).json({ success: false, message: '修改密码失败。' });
    }
});

app.post('/api/admin/delete-user', requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, message: '缺少使用者 ID。' });
    }
    try {
        await data.deleteUser(userId);
        res.json({ success: true, message: '使用者已删除。' });
    } catch (error) {
        res.status(500).json({ success: false, message: '删除使用者失败。' });
    }
});

app.get('/api/admin/webdav', requireAdmin, (req, res) => {
    const config = storageManager.readConfig();
    const webdavConfig = config.webdav || {};
    // 为了前端兼容性，即使只有一个设定，也以阵列形式回传
    res.json(webdavConfig.url ? [{ id: 1, ...webdavConfig }] : []);
});

app.post('/api/admin/webdav', requireAdmin, (req, res) => {
    const { url, username, password } = req.body;
    if (!url || !username) { 
        return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    const config = storageManager.readConfig();
    
    // 简化为只管理一个 WebDAV 配置
    config.webdav = { url, username };
    // 只有当提供了新密码时才更新它
    if (password) {
        config.webdav.password = password;
    }

    if (storageManager.writeConfig(config)) {
        res.json({ success: true, message: 'WebDAV 设定已储存' });
    } else {
        res.status(500).json({ success: false, message: '写入设定失败' });
    }
});

app.delete('/api/admin/webdav/:id', requireAdmin, (req, res) => {
    const config = storageManager.readConfig();
    config.webdav = {}; // 直接清空设定
    if (storageManager.writeConfig(config)) {
        res.json({ success: true, message: 'WebDAV 设定已删除' });
    } else {
        res.status(500).json({ success: false, message: '删除设定失败' });
    }
});

// 使用 multer 中间件的包装器以进行错误处理
const uploadMiddleware = (req, res, next) => {
    const uploader = upload.array('files');
    uploader(req, res, function (err) {
        if (err) {
            console.error("Multer upload error:", err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: '文件大小超出限制。' });
            }
            // 捕获磁盘空间不足等系统错误
            if (err.code === 'EDQUOT' || err.errno === -122) {
                return res.status(507).json({ success: false, message: '上传失败：磁盘空间不足。' });
            }
            return res.status(500).json({ success: false, message: '上传档案到暂存区时发生错误。' });
        }
        next();
    });
};

app.post('/upload', requireLogin, async (req, res, next) => {
    // 每次上传前都先清理一次
    await cleanupTempDir();
    next();
}, uploadMiddleware, fixFileNameEncoding, async (req, res) => {

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: '没有选择文件' });
    }

    const initialFolderId = parseInt(req.body.folderId, 10);
    const userId = req.session.userId;
    const storage = storageManager.getStorage();
    const overwritePaths = req.body.overwritePaths ? JSON.parse(req.body.overwritePaths) : [];
    let relativePaths = req.body.relativePaths;

    if (!relativePaths) {
        relativePaths = req.files.map(file => file.originalname);
    } else if (!Array.isArray(relativePaths)) {
        relativePaths = [relativePaths];
    }

    if (req.files.length !== relativePaths.length) {
        return res.status(400).json({ success: false, message: '上传档案和路径资讯不匹配。' });
    }

    const results = [];
    try {
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const tempFilePath = file.path;
            const relativePath = relativePaths[i];

            try {
                const pathParts = (relativePath || file.originalname).split('/');
                const fileName = pathParts.pop() || file.originalname;
                const folderPathParts = pathParts;

                const isOverwrite = overwritePaths.includes(relativePath);
                const targetFolderId = await data.resolvePathToFolderId(initialFolderId, folderPathParts, userId);
                
                if (isOverwrite) {
                    const existingFile = await data.findFileInFolder(fileName, targetFolderId, userId);
                    if (existingFile) {
                        const filesToDelete = await data.getFilesByIds([existingFile.message_id], userId);
                        // **修复：先物理删除，再数据库删除**
                        if (filesToDelete.length > 0) {
                           await storage.remove(filesToDelete, [], userId); 
                        }
                        await data.deleteFilesByIds([existingFile.message_id], userId);
                    }
                } else {
                     const conflict = await data.findFileInFolder(fileName, targetFolderId, userId);
                     if (conflict) {
                         console.log(`Skipping file "${relativePath}" because it exists and was not marked for overwrite.`);
                         continue; // 跳过此文件
                     }
                }

                // 核心修改：传递临时文件路径而不是 buffer
                const result = await storage.upload(tempFilePath, fileName, file.mimetype, userId, targetFolderId, req.body.caption || '');
                results.push(result);

            } finally {
                // 无论成功或失败都删除临时文件
                if (fs.existsSync(tempFilePath)) {
                    await fsp.unlink(tempFilePath).catch(err => console.error(`无法删除临时档: ${tempFilePath}`, err));
                }
            }
        }
        res.json({ success: true, results });
    } catch (error) {
        console.error("Upload processing error:", error);
        // 如果出错，确保清理所有已上传的临时文件
        for (const file of req.files) {
            if (fs.existsSync(file.path)) {
                await fsp.unlink(file.path).catch(err => console.error(`无法删除错误处理中的临时档: ${file.path}`, err));
            }
        }
        res.status(500).json({ success: false, message: '处理上传时发生错误: ' + error.message });
    }
});

app.post('/api/text-file', requireLogin, async (req, res) => {
    const { mode, fileId, folderId, fileName, content } = req.body;
    const userId = req.session.userId;
    const storage = storageManager.getStorage();

    if (!fileName || !fileName.endsWith('.txt')) {
        return res.status(400).json({ success: false, message: '档名无效或不是 .txt 档案' });
    }

    const tempFilePath = path.join(TMP_DIR, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.txt`);

    try {
        await fsp.writeFile(tempFilePath, content, 'utf8');
        let result;

        if (mode === 'edit' && fileId) {
             const filesToDelete = await data.getFilesByIds([fileId], userId);
            if (filesToDelete.length > 0) {
                // **修复：同样修复编辑逻辑**
                await storage.remove(filesToDelete, [], userId);
                await data.deleteFilesByIds([fileId], userId);

                result = await storage.upload(tempFilePath, fileName, 'text/plain', userId, filesToDelete[0].folder_id);
            } else {
                return res.status(404).json({ success: false, message: '找不到要编辑的原始档案' });
            }
        } else if (mode === 'create' && folderId) {
             const conflict = await data.checkFullConflict(fileName, folderId, userId);
            if (conflict) {
                return res.status(409).json({ success: false, message: '同目录下已存在同名档案或资料夹。' });
            }
            result = await storage.upload(tempFilePath, fileName, 'text/plain', userId, folderId);
        } else {
            return res.status(400).json({ success: false, message: '请求参数无效' });
        }
        res.json({ success: true, fileId: result.fileId });
    } catch (error) {
        console.error("Text file error:", error);
        res.status(500).json({ success: false, message: '伺服器内部错误' });
    } finally {
        // 清理临时文件
        if (fs.existsSync(tempFilePath)) {
            await fsp.unlink(tempFilePath).catch(err => console.error(`无法删除文字档的临时档: ${tempFilePath}`, err));
        }
    }
});


app.get('/api/file-info/:id', requireLogin, async (req, res) => {
    try {
        const fileId = parseInt(req.params.id, 10);
        const [fileInfo] = await data.getFilesByIds([fileId], req.session.userId);
        if (fileInfo) {
            res.json(fileInfo);
        } else {
            res.status(404).json({ success: false, message: '找不到档案资讯' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: '获取档案资讯失败' });
    }
});

app.post('/api/check-existence', requireLogin, async (req, res) => {
    try {
        const { files: filesToCheck, folderId: initialFolderId } = req.body;
        const userId = req.session.userId;

        if (!filesToCheck || !Array.isArray(filesToCheck) || !initialFolderId) {
            return res.status(400).json({ success: false, message: '无效的请求参数。' });
        }

        const existenceChecks = await Promise.all(
            filesToCheck.map(async (fileInfo) => {
                const { relativePath } = fileInfo;
                const pathParts = (relativePath || '').split('/');
                const fileName = pathParts.pop() || relativePath;
                const folderPathParts = pathParts;

                const targetFolderId = await data.findFolderByPath(initialFolderId, folderPathParts, userId);
                
                if (targetFolderId === null) {
                    return { name: fileName, relativePath, exists: false, messageId: null };
                }

                const existingFile = await data.findFileInFolder(fileName, targetFolderId, userId);
                return { name: fileName, relativePath, exists: !!existingFile, messageId: existingFile ? existingFile.message_id : null };
            })
        );
        res.json({ success: true, files: existenceChecks });
    } catch (error) {
        console.error("Existence check error:", error);
        res.status(500).json({ success: false, message: "检查档案是否存在时发生内部错误。" });
    }
});

app.post('/api/check-move-conflict', requireLogin, async (req, res) => {
    try {
        const { itemIds, targetFolderId } = req.body;
        const userId = req.session.userId;

        if (!itemIds || !Array.isArray(itemIds) || !targetFolderId) {
            return res.status(400).json({ success: false, message: '无效的请求参数。' });
        }

        const fileConflictNames = new Set();
        const folderConflictNames = new Set();

        async function findConflictsRecursive(itemsToMove, destinationFolderId) {
            if (!itemsToMove || itemsToMove.length === 0) {
                return;
            }

            const itemNames = itemsToMove.map(item => item.name);
            const conflictsInDest = await data.getConflictingItems(itemNames, destinationFolderId, userId);

            for (const item of itemsToMove) {
                const conflict = conflictsInDest.find(c => c.name === item.name);

                if (conflict) {
                    if (item.type === 'folder' && conflict.type === 'folder') {
                        folderConflictNames.add(item.name);
                        
                        const sourceChildren = await data.getChildrenOfFolder(item.id, userId);
                        const destFolderForMerge = await data.findFolderByName(item.name, destinationFolderId, userId);
                        
                        if (destFolderForMerge) {
                            await findConflictsRecursive(sourceChildren, destFolderForMerge.id);
                        }
                    } else {
                        fileConflictNames.add(item.name);
                    }
                }
            }
        }

        const topLevelItems = await data.getItemsByIds(itemIds, userId);
        await findConflictsRecursive(topLevelItems, targetFolderId);

        res.json({
            success: true,
            fileConflicts: Array.from(fileConflictNames),
            folderConflicts: Array.from(folderConflictNames)
        });

    } catch (error) {
        console.error("Conflict check error:", error);
        res.status(500).json({ success: false, message: '检查名称冲突时出错。' });
    }
});


app.get('/api/search', requireLogin, async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ success: false, message: '需要提供搜寻关键字。' });
        
        const contents = await data.searchItems(query, req.session.userId); 
        
        const path = [{ id: null, name: `搜寻结果: "${query}"` }];
        res.json({ contents, path });
    } catch (error) { 
        res.status(500).json({ success: false, message: '搜寻失败。' }); 
    }
});

app.get('/api/folder/:id', requireLogin, async (req, res) => {
    try {
        const folderId = parseInt(req.params.id, 10);
        const contents = await data.getFolderContents(folderId, req.session.userId);
        const path = await data.getFolderPath(folderId, req.session.userId);
        res.json({ contents, path });
    } catch (error) { res.status(500).json({ success: false, message: '读取资料夹内容失败。' }); }
});


app.post('/api/folder', requireLogin, async (req, res) => {
    const { name, parentId } = req.body;
    const userId = req.session.userId;
    if (!name || !parentId) {
        return res.status(400).json({ success: false, message: '缺少资料夹名称或父 ID。' });
    }
    
    try {
        const conflict = await data.checkFullConflict(name, parentId, userId);
        if (conflict) {
            return res.status(409).json({ success: false, message: '同目录下已存在同名档案或资料夹。' });
        }

        const result = await data.createFolder(name, parentId, userId);
        res.json(result);
    } catch (error) {
         res.status(500).json({ success: false, message: error.message || '处理资料夹时发生错误。' });
    }
});


app.get('/api/folders', requireLogin, async (req, res) => {
    const folders = await data.getAllFolders(req.session.userId);
    res.json(folders);
});

app.post('/api/move', requireLogin, async (req, res) => {
    try {
        const { itemIds, targetFolderId, overwriteList = [], mergeList = [] } = req.body;
        const userId = req.session.userId;
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0 || !targetFolderId) {
            return res.status(400).json({ success: false, message: '无效的请求参数。' });
        }
        
        const items = await data.getItemsByIds(itemIds, userId);
        
        for (const item of items) {
            await data.moveItem(item.id, item.type, targetFolderId, userId, { overwriteList, mergeList });
        }
        
        res.json({ success: true, message: "移动成功" });
    } catch (error) { 
        console.error("Move error:", error);
        res.status(500).json({ success: false, message: '移动失败：' + error.message }); 
    }
});

// 统一的删除处理器
async function unifiedDeleteHandler(req, res) {
    const { messageIds = [], folderIds = [] } = req.body;
    const userId = req.session.userId;
    
    if (!Array.isArray(messageIds) || !Array.isArray(folderIds) || (messageIds.length === 0 && folderIds.length === 0)) {
        return res.status(400).json({ success: false, message: '无效的请求参数。' });
    }

    try {
        const storage = storageManager.getStorage();
        let filesForStorage = [];
        let foldersForStorage = [];
        
        // 1. 收集所有要删除的项目信息
        if (folderIds.length > 0) {
            for (const folderId of folderIds) {
                const deletionData = await data.getFolderDeletionData(folderId, userId);
                filesForStorage.push(...deletionData.files);
                foldersForStorage.push(...deletionData.folders);
            }
        }
        
        if (messageIds.length > 0) {
            const directFiles = await data.getFilesByIds(messageIds, userId);
            filesForStorage.push(...directFiles);
        }
        
        // 2. 执行物理删除
        const storageResult = await storage.remove(filesForStorage, foldersForStorage, userId);
        
        if (!storageResult.success) {
            console.warn("部分档案在储存端删除失败:", storageResult.errors);
        }

        // 3. 执行数据库删除
        const allFileIdsToDelete = filesForStorage.map(f => f.message_id);
        const allFolderIdsToDelete = foldersForStorage.map(f => f.id);
        await data.executeDeletion(allFileIdsToDelete, allFolderIdsToDelete, userId);

        res.json({ success: true, message: '删除操作已完成。' });

    } catch (error) {
        console.error("删除操作失败:", error);
        res.status(500).json({ success: false, message: '删除过程中发生错误: ' + error.message });
    }
}


app.post('/api/folder/delete', requireLogin, (req, res) => {
    const { folderId } = req.body;
    req.body.folderIds = [folderId];
    req.body.messageIds = [];
    unifiedDeleteHandler(req, res);
});

app.post('/delete-multiple', requireLogin, unifiedDeleteHandler);


app.post('/rename', requireLogin, async (req, res) => {
    try {
        const { id, newName, type } = req.body;
        const userId = req.session.userId;
        if (!id || !newName || !type) {
            return res.status(400).json({ success: false, message: '缺少必要参数。'});
        }

        let result;
        if (type === 'file') {
            result = await data.renameFile(parseInt(id, 10), newName, userId);
        } else if (type === 'folder') {
            result = await data.renameFolder(parseInt(id, 10), newName, userId);
        } else {
            return res.status(400).json({ success: false, message: '无效的项目类型。'});
        }
        res.json(result);
    } catch (error) { 
        res.status(500).json({ success: false, message: '重命名失败' }); 
    }
});

app.get('/thumbnail/:message_id', requireLogin, async (req, res) => {
    try {
        const messageId = parseInt(req.params.message_id, 10);
        const [fileInfo] = await data.getFilesByIds([messageId], req.session.userId);

        if (fileInfo && fileInfo.storage_type === 'telegram' && fileInfo.thumb_file_id) {
            const storage = storageManager.getStorage();
            const link = await storage.getUrl(fileInfo.thumb_file_id);
            if (link) return res.redirect(link);
        }
        
        const placeholder = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': placeholder.length });
        res.end(placeholder);

    } catch (error) { res.status(500).send('获取缩图失败'); }
});

app.get('/download/proxy/:message_id', requireLogin, async (req, res) => {
    try {
        const messageId = parseInt(req.params.message_id, 10);
        const [fileInfo] = await data.getFilesByIds([messageId], req.session.userId);
        
        if (!fileInfo || !fileInfo.file_id) {
            return res.status(404).send('文件信息未找到');
        }

        const storage = storageManager.getStorage();
        
        if (req.headers.range) { 
            res.setHeader('Accept-Ranges', 'bytes');
        } else {
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);
        }
        
        if (fileInfo.mimetype) {
            res.setHeader('Content-Type', fileInfo.mimetype);
        }
        if (fileInfo.size) {
            res.setHeader('Content-Length', fileInfo.size);
        }


        if (fileInfo.storage_type === 'telegram') {
            const link = await storage.getUrl(fileInfo.file_id);
            if (link) {
                const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                response.data.pipe(res);
            } else { res.status(404).send('无法获取文件链接'); }
        } else if (fileInfo.storage_type === 'local') {
            if (fs.existsSync(fileInfo.file_id)) {
                res.download(fileInfo.file_id, fileInfo.fileName);
            } else {
                res.status(404).send('本地档案不存在');
            }
        } else if (fileInfo.storage_type === 'webdav') {
            const stream = await storage.stream(fileInfo.file_id, req.session.userId);
            handleStream(stream, res);
        }

    } catch (error) { res.status(500).send('下载代理失败'); }
});

app.get('/file/content/:message_id', requireLogin, async (req, res) => {
    try {
        const messageId = parseInt(req.params.message_id, 10);
        const [fileInfo] = await data.getFilesByIds([messageId], req.session.userId);

        if (!fileInfo || !fileInfo.file_id) {
            return res.status(404).send('文件信息未找到');
        }
        
        const storage = storageManager.getStorage();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');

        if (fileInfo.storage_type === 'telegram') {
            const link = await storage.getUrl(fileInfo.file_id);
            if (link) {
                const response = await axios.get(link, { responseType: 'text' });
                res.send(response.data);
            } else { res.status(404).send('无法获取文件链接'); }
        } else if (fileInfo.storage_type === 'local') {
            if (fs.existsSync(fileInfo.file_id)) {
                const content = await fsp.readFile(fileInfo.file_id, 'utf-8');
                res.send(content);
            } else {
                res.status(404).send('本地档案不存在');
            }
        } else if (fileInfo.storage_type === 'webdav') {
            const stream = await storage.stream(fileInfo.file_id, req.session.userId);
            handleStream(stream, res);
        }
    } catch (error) { 
        console.error("File content error:", error);
        res.status(500).send('无法获取文件内容'); 
    }
});


app.post('/api/download-archive', requireLogin, async (req, res) => {
    try {
        const { messageIds = [], folderIds = [] } = req.body;
        const userId = req.session.userId;
        const storage = storageManager.getStorage();

        if (messageIds.length === 0 && folderIds.length === 0) {
            return res.status(400).send('未提供任何项目 ID');
        }
        let filesToArchive = [];
        if (messageIds.length > 0) {
            const directFiles = await data.getFilesByIds(messageIds, userId);
            filesToArchive.push(...directFiles.map(f => ({ ...f, path: f.fileName })));
        }
        for (const folderId of folderIds) {
            const folderInfo = (await data.getFolderPath(folderId, userId)).pop();
            const folderName = folderInfo ? folderInfo.name : 'folder';
            const nestedFiles = await data.getFilesRecursive(folderId, userId, folderName);
            filesToArchive.push(...nestedFiles);
        }
        if (filesToArchive.length === 0) {
            return res.status(404).send('找不到任何可下载的档案');
        }
        
        const archive = archiver('zip', { zlib: { level: 9 } });
        res.attachment('download.zip');
        archive.pipe(res);

        for (const file of filesToArchive) {
             if (file.storage_type === 'telegram') {
                const link = await storage.getUrl(file.file_id);
                if (link) {
                    const response = await axios({ url: link, method: 'GET', responseType: 'stream' });
                    archive.append(response.data, { name: file.path });
                }
            } else if (file.storage_type === 'local') {
                if (fs.existsSync(file.file_id)) {
                    archive.file(file.file_id, { name: file.path });
                }
            } else if (file.storage_type === 'webdav') {
                const stream = await storage.stream(file.file_id, userId);
                archive.append(stream, { name: file.path });
            }
        }
        await archive.finalize();
    } catch (error) {
        res.status(500).send('压缩档案时发生错误');
    }
});


app.post('/share', requireLogin, async (req, res) => {
    try {
        const { itemId, itemType, expiresIn } = req.body;
        if (!itemId || !itemType || !expiresIn) {
            return res.status(400).json({ success: false, message: '缺少必要参数。' });
        }
        
        const result = await data.createShareLink(parseInt(itemId, 10), itemType, expiresIn, req.session.userId);
        
        if (result.success) {
            const shareUrl = `${req.protocol}://${req.get('host')}/share/view/${itemType}/${result.token}`;
            res.json({ success: true, url: shareUrl });
        } else {
            res.status(404).json(result); 
        }
    } catch (error) {
        console.error("Share link creation error:", error);
        res.status(500).json({ success: false, message: '在伺服器上建立分享连结时发生错误。' });
    }
});

app.get('/api/shares', requireLogin, async (req, res) => {
    try {
        const shares = await data.getActiveShares(req.session.userId);
        const fullUrlShares = shares.map(item => ({
            ...item,
            share_url: `${req.protocol}://${req.get('host')}/share/view/${item.type}/${item.share_token}`
        }));
        res.json(fullUrlShares);
    } catch (error) { res.status(500).json({ success: false, message: '获取分享列表失败' }); }
});

app.post('/api/cancel-share', requireLogin, async (req, res) => {
    try {
        const { itemId, itemType } = req.body;
        if (!itemId || !itemType) return res.status(400).json({ success: false, message: '缺少必要参数' });
        const result = await data.cancelShare(parseInt(itemId, 10), itemType, req.session.userId);
        res.json(result);
    } catch (error) { res.status(500).json({ success: false, message: '取消分享失败' }); }
});

// --- 新生：扫描 API 端点 ---
app.post('/api/scan/local', requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const log = [];
    try {
        if (!userId) throw new Error('未提供使用者 ID');

        const userUploadDir = path.join(__dirname, 'data', 'uploads', String(userId));
        if (!fs.existsSync(userUploadDir)) {
            log.push({ message: `使用者 ${userId} 的本地储存目录不存在，跳过。`, type: 'warn' });
            return res.json({ success: true, log });
        }
        
        const rootFolder = await data.getRootFolder(userId);
        if (!rootFolder) {
            throw new Error(`找不到使用者 ${userId} 的根目录`);
        }

        async function scanDirectory(dir, parentFolderId) {
            const entries = await fsp.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(userUploadDir, fullPath).replace(/\\/g, '/');

                if (entry.isDirectory()) {
                    const newParentFolderId = await data.findOrCreateFolderByPath(relativePath, userId);
                    log.push({ message: `进入目录: ${relativePath}`, type: 'info' });
                    await scanDirectory(fullPath, newParentFolderId);
                } else {
                    const fileId = fullPath;
                    const existing = await data.findFileByFileId(fileId, userId);
                    if (existing) {
                        log.push({ message: `已存在: ${relativePath}，跳过。`, type: 'info' });
                    } else {
                        const stats = await fsp.stat(fullPath);
                        const messageId = BigInt(Date.now()) * 1000000n + BigInt(crypto.randomInt(1000000));
                        await data.addFile({
                            message_id: messageId,
                            fileName: entry.name,
                            mimetype: 'application/octet-stream', // 本地扫描无法轻易得知 mimetype
                            size: stats.size,
                            file_id: fileId,
                            date: stats.mtime.getTime(),
                        }, parentFolderId, userId, 'local');
                        log.push({ message: `已汇入: ${relativePath}`, type: 'success' });
                    }
                }
            }
        }
        await scanDirectory(userUploadDir, rootFolder.id);
        res.json({ success: true, log });
    } catch (error) {
        console.error('Local scan error:', error);
        log.push({ message: `扫描本地文件时出错: ${error.message}`, type: 'error' });
        res.status(500).json({ success: false, message: error.message, log });
    }
});

app.post('/api/scan/webdav', requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const log = [];
    try {
        if (!userId) throw new Error('未提供使用者 ID');

        const { createClient } = require('webdav');
        const config = storageManager.readConfig();
        if (!config.webdav || !config.webdav.url) {
            throw new Error('WebDAV 设定不完整');
        }
        const client = createClient(config.webdav.url, {
            username: config.webdav.username,
            password: config.webdav.password
        });
        
        async function scanWebdavDirectory(remotePath) {
            const contents = await client.getDirectoryContents(remotePath, { deep: true });
            for (const item of contents) {
                if (item.type === 'file') {
                    const existing = await data.findFileByFileId(item.filename, userId);
                     if (existing) {
                        log.push({ message: `已存在: ${item.filename}，跳过。`, type: 'info' });
                    } else {
                        const folderPath = path.dirname(item.filename).replace(/\\/g, '/');
                        const folderId = await data.findOrCreateFolderByPath(folderPath, userId);
                        
                        const messageId = BigInt(Date.now()) * 1000000n + BigInt(crypto.randomInt(1000000));
                        await data.addFile({
                            message_id: messageId,
                            fileName: item.basename,
                            mimetype: item.mime || 'application/octet-stream',
                            size: item.size,
                            file_id: item.filename,
                            date: new Date(item.lastmod).getTime(),
                        }, folderId, userId, 'webdav');
                        log.push({ message: `已汇入: ${item.filename}`, type: 'success' });
                    }
                }
            }
        }
        
        await scanWebdavDirectory('/');
        res.json({ success: true, log });

    } catch (error) {
        let errorMessage = error.message;
        if (error.response && error.response.status === 403) {
            errorMessage = '存取被拒绝 (403 Forbidden)。这通常意味着您的 WebDAV 伺服器不允许列出目录内容。请检查您帐号的权限，确保它有读取和浏览目录的权限。';
            log.push({ message: '扫描失败：无法列出远端目录内容。', type: 'error' });
        }
        log.push({ message: `详细错误: ${errorMessage}`, type: 'error' });
        res.status(500).json({ success: false, message: errorMessage, log });
    }
});

app.get('/share/view/file/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const fileInfo = await data.getFileByShareToken(token);
        if (fileInfo) {
            const downloadUrl = `/share/download/file/${token}`;
            let textContent = null;
            if (fileInfo.mimetype && fileInfo.mimetype.startsWith('text/')) {
                const storage = storageManager.getStorage();
                 if (fileInfo.storage_type === 'telegram') {
                    const link = await storage.getUrl(fileInfo.file_id);
                    if (link) {
                        const response = await axios.get(link, { responseType: 'text' });
                        textContent = response.data;
                    }
                } else if (fileInfo.storage_type === 'local') {
                    textContent = await fsp.readFile(fileInfo.file_id, 'utf-8');
                } else if (fileInfo.storage_type === 'webdav') {
                    const stream = await storage.stream(fileInfo.file_id, fileInfo.user_id);
                    textContent = await new Promise((resolve, reject) => {
                        let data = '';
                        stream.on('data', chunk => data += chunk);
                        stream.on('end', () => resolve(data));
                        stream.on('error', err => reject(err));
                    });
                }
            }
            res.render('share-view', { file: fileInfo, downloadUrl, textContent });
        } else {
            res.status(404).render('share-error', { message: '此分享连结无效或已过期。' });
        }
    } catch (error) { res.status(500).render('share-error', { message: '处理分享请求时发生错误。' }); }
});

app.get('/share/view/folder/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const folderInfo = await data.getFolderByShareToken(token);
        if (folderInfo) {
            const contents = await data.getFolderContents(folderInfo.id, folderInfo.user_id);
            res.render('share-folder-view', { folder: folderInfo, contents });
        } else {
            res.status(404).render('share-error', { message: '此分享连结无效或已过期。' });
        }
    } catch (error) { 
        res.status(500).render('share-error', { message: '处理分享请求时发生错误。' }); 
    }
});

function handleStream(stream, res) {
    stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
            res.status(500).send('读取文件流时发生错误');
        }
    }).on('close', () => {
        stream.destroy();
    }).pipe(res).on('finish', () => {
        stream.destroy();
    });
}

app.get('/share/download/file/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const fileInfo = await data.getFileByShareToken(token);
        if (!fileInfo || !fileInfo.file_id) {
             return res.status(404).send('文件信息未找到或分享链接已过期');
        }

        const storage = storageManager.getStorage();
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);

        if (fileInfo.storage_type === 'telegram') {
            const link = await storage.getUrl(fileInfo.file_id);
            if (link) {
                const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                response.data.pipe(res);
            } else { res.status(404).send('无法获取文件链接'); }
        } else if (fileInfo.storage_type === 'local') {
            res.download(fileInfo.file_id, fileInfo.fileName);
        } else if (fileInfo.storage_type === 'webdav') {
            const stream = await storage.stream(fileInfo.file_id, fileInfo.user_id);
            handleStream(stream, res);
        }

    } catch (error) { res.status(500).send('下载失败'); }
});

app.get('/share/thumbnail/:folderToken/:fileId', async (req, res) => {
    try {
        const { folderToken, fileId } = req.params;
        const fileInfo = await data.findFileInSharedFolder(parseInt(fileId, 10), folderToken);

        if (fileInfo && fileInfo.storage_type === 'telegram' && fileInfo.thumb_file_id) {
            const storage = storageManager.getStorage();
            const link = await storage.getUrl(fileInfo.thumb_file_id);
            if (link) return res.redirect(link);
        }
        
        const placeholder = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': placeholder.length });
        res.end(placeholder);

    } catch (error) {
        res.status(500).send('获取缩图失败');
    }
});

app.get('/share/download/:folderToken/:fileId', async (req, res) => {
    try {
        const { folderToken, fileId } = req.params;
        const fileInfo = await data.findFileInSharedFolder(parseInt(fileId, 10), folderToken);
        
        if (!fileInfo || !fileInfo.file_id) {
             return res.status(404).send('文件信息未找到或权限不足');
        }
        
        const storage = storageManager.getStorage();
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);

        if (fileInfo.storage_type === 'telegram') {
            const link = await storage.getUrl(fileInfo.file_id);
            if (link) {
                const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                response.data.pipe(res);
            } else { res.status(404).send('无法获取文件链接'); }
        } else if (fileInfo.storage_type === 'local') { 
            if (fs.existsSync(fileInfo.file_id)) {
                res.download(fileInfo.file_id, fileInfo.fileName);
            } else {
                res.status(404).send('本地档案不存在');
            }
        } else if (fileInfo.storage_type === 'webdav') {
            const stream = await storage.stream(fileInfo.file_id, fileInfo.user_id);
            handleStream(stream, res);
        }
    } catch (error) {
        res.status(500).send('下载失败');
    }
});


app.listen(PORT, () => console.log(`✅ 伺服器已在 http://localhost:${PORT} 上运行`));
