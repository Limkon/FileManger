const db = require('./database.js');
const crypto = require('crypto');
const path = require('path');

// --- 使用者管理 ---
function createUser(username, hashedPassword) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO users (username, password, is_admin) VALUES (?, ?, 0)`;
        db.run(sql, [username, hashedPassword], function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, username });
        });
    });
}

function findUserByName(username) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function findUserById(id) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function changeUserPassword(userId, newHashedPassword) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE users SET password = ? WHERE id = ?`;
        db.run(sql, [newHashedPassword, userId], function(err) {
            if (err) return reject(err);
            resolve({ success: true, changes: this.changes });
        });
    });
}

function listNormalUsers() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT id, username FROM users WHERE is_admin = 0 ORDER BY username ASC`;
        db.all(sql, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function listAllUsers() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT id, username FROM users ORDER BY username ASC`;
        db.all(sql, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}


function deleteUser(userId) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM users WHERE id = ? AND is_admin = 0`;
        db.run(sql, [userId], function(err) {
            if (err) return reject(err);
            resolve({ success: true, changes: this.changes });
        });
    });
}


// --- 档案和资料夹搜寻 ---
function searchItems(query, userId) {
    return new Promise((resolve, reject) => {
        const searchQuery = `%${query}%`;
        const sqlFolders = `
            SELECT id, name, parent_id, 'folder' as type
            FROM folders
            WHERE name LIKE ? AND user_id = ? AND parent_id IS NOT NULL
            ORDER BY name ASC`;

        const sqlFiles = `
            SELECT *, message_id as id, fileName as name, 'file' as type
            FROM files
            WHERE fileName LIKE ? AND user_id = ?
            ORDER BY date DESC`;

        let contents = { folders: [], files: [] };

        db.all(sqlFolders, [searchQuery, userId], (err, folders) => {
            if (err) return reject(err);
            contents.folders = folders;
            db.all(sqlFiles, [searchQuery, userId], (err, files) => {
                if (err) return reject(err);
                contents.files = files.map(f => ({ ...f, message_id: f.id }));
                resolve(contents);
            });
        });
    });
}

// --- 资料夹与档案操作 ---
function getItemsByIds(itemIds, userId) {
    return new Promise((resolve, reject) => {
        if (!itemIds || itemIds.length === 0) return resolve([]);
        const placeholders = itemIds.map(() => '?').join(',');
        const sql = `
            SELECT id, name, 'folder' as type FROM folders WHERE id IN (${placeholders}) AND user_id = ?
            UNION ALL
            SELECT message_id as id, fileName as name, 'file' as type FROM files WHERE message_id IN (${placeholders}) AND user_id = ?
        `;
        db.all(sql, [...itemIds, userId, ...itemIds, userId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function getChildrenOfFolder(folderId, userId) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT id, name, 'folder' as type FROM folders WHERE parent_id = ? AND user_id = ?
            UNION ALL
            SELECT message_id as id, fileName as name, 'file' as type FROM files WHERE folder_id = ? AND user_id = ?
        `;
        db.all(sql, [folderId, userId, folderId, userId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

async function getAllDescendantFolderIds(folderId, userId) {
    let descendants = [];
    let queue = [folderId];
    const visited = new Set(queue);

    while (queue.length > 0) {
        const currentId = queue.shift();
        const sql = `SELECT id FROM folders WHERE parent_id = ? AND user_id = ?`;
        const children = await new Promise((resolve, reject) => {
            db.all(sql, [currentId, userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        for (const child of children) {
            if (!visited.has(child.id)) {
                visited.add(child.id);
                descendants.push(child.id);
                queue.push(child.id);
            }
        }
    }
    return descendants;
}

function getFolderContents(folderId, userId) {
    return new Promise((resolve, reject) => {
        const sqlFolders = `SELECT id, name, parent_id, 'folder' as type FROM folders WHERE parent_id = ? AND user_id = ? ORDER BY name ASC`;
        const sqlFiles = `SELECT *, message_id as id, fileName as name, 'file' as type FROM files WHERE folder_id = ? AND user_id = ? ORDER BY name ASC`;
        let contents = { folders: [], files: [] };
        db.all(sqlFolders, [folderId, userId], (err, folders) => {
            if (err) return reject(err);
            contents.folders = folders;
            db.all(sqlFiles, [folderId, userId], (err, files) => {
                if (err) return reject(err);
                contents.files = files.map(f => ({ ...f, message_id: f.id }));
                resolve(contents);
            });
        });
    });
}

async function getFilesRecursive(folderId, userId, currentPath = '') {
    let allFiles = [];
    const sqlFiles = "SELECT * FROM files WHERE folder_id = ? AND user_id = ?";
    const files = await new Promise((res, rej) => db.all(sqlFiles, [folderId, userId], (err, rows) => err ? rej(err) : res(rows)));
    for (const file of files) {
        allFiles.push({ ...file, path: path.join(currentPath, file.fileName) });
    }

    const sqlFolders = "SELECT id, name FROM folders WHERE parent_id = ? AND user_id = ?";
    const subFolders = await new Promise((res, rej) => db.all(sqlFolders, [folderId, userId], (err, rows) => err ? rej(err) : res(rows)));
    for (const subFolder of subFolders) {
        const nestedFiles = await getFilesRecursive(subFolder.id, userId, path.join(currentPath, subFolder.name));
        allFiles.push(...nestedFiles);
    }
    return allFiles;
}

async function getDescendantFiles(folderIds, userId) {
    let allFiles = [];
    for (const folderId of folderIds) {
        const nestedFiles = await getFilesRecursive(folderId, userId);
        allFiles.push(...nestedFiles);
    }
    return allFiles;
}

function getFolderPath(folderId, userId) {
    let pathArr = [];
    return new Promise((resolve, reject) => {
        function findParent(id) {
            if (!id) return resolve(pathArr.reverse());
            db.get("SELECT id, name, parent_id FROM folders WHERE id = ? AND user_id = ?", [id, userId], (err, folder) => {
                if (err) return reject(err);
                if (folder) {
                    pathArr.push({ id: folder.id, name: folder.name });
                    findParent(folder.parent_id);
                } else {
                    resolve(pathArr.reverse());
                }
            });
        }
        findParent(folderId);
    });
}

function createFolder(name, parentId, userId) {
    const sql = `INSERT INTO folders (name, parent_id, user_id) VALUES (?, ?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [name, parentId, userId], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return reject(new Error('同目录下已存在同名资料夹。'));
                return reject(err);
            }
            resolve({ success: true, id: this.lastID });
        });
    });
}

function findFolderByName(name, parentId, userId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT id FROM folders WHERE name = ? AND parent_id = ? AND user_id = ?`;
        db.get(sql, [name, parentId, userId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function findFolderByPath(startFolderId, pathParts, userId) {
    let currentParentId = startFolderId;
    for (const part of pathParts) {
        if (!part) continue;
        const folder = await new Promise((resolve, reject) => {
            const sql = `SELECT id FROM folders WHERE name = ? AND parent_id = ? AND user_id = ?`;
            db.get(sql, [part, currentParentId, userId], (err, row) => err ? reject(err) : resolve(row));
        });

        if (folder) {
            currentParentId = folder.id;
        } else {
            return null; 
        }
    }
    return currentParentId;
}


function getAllFolders(userId) {
    return new Promise((resolve, reject) => {
        const sql = "SELECT id, name, parent_id FROM folders WHERE user_id = ? ORDER BY parent_id, name ASC";
        db.all(sql, [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function moveItem(itemId, itemType, targetFolderId, userId, options = {}) {
    const { overwriteList = [], mergeList = [] } = options;

    if (itemType === 'folder') {
        const folderToMove = (await getItemsByIds([itemId], userId))[0];
        if (!folderToMove) throw new Error(`找不到来源资料夹 ID: ${itemId}`);

        const existingFolder = await findFolderByName(folderToMove.name, targetFolderId, userId);

        if (existingFolder) {
            if (mergeList.includes(folderToMove.name)) {
                // 合并逻辑
                const children = await getChildrenOfFolder(itemId, userId);
                for (const child of children) {
                    await moveItem(child.id, child.type, existingFolder.id, userId, options);
                }
                const remainingChildren = await getChildrenOfFolder(itemId, userId);
                if (remainingChildren.length === 0) {
                    await deleteSingleFolder(itemId, userId);
                }
            }
        } else {
            // 没有冲突，直接移动
            await moveItems([], [itemId], targetFolderId, userId);
        }
    } else { // file
        const fileToMove = (await getFilesByIds([itemId], userId))[0];
        if (!fileToMove) throw new Error(`找不到来源档案 ID: ${itemId}`);
        
        const conflict = await findFileInFolder(fileToMove.fileName, targetFolderId, userId);
        
        if (conflict && overwriteList.includes(fileToMove.fileName)) {
            const storage = require('./storage').getStorage();
            const filesToDelete = await getFilesByIds([conflict.message_id], userId);
            // **最终修复：确保在移动前，先删除物理文件，再删除数据库记录**
            if (filesToDelete.length > 0) {
                await storage.remove(filesToDelete, [], userId);
            }
            await deleteFilesByIds([conflict.message_id], userId);

            await moveItems([itemId], [], targetFolderId, userId);
        } else if (!conflict) {
            await moveItems([itemId], [], targetFolderId, userId);
        }
    }
}

function moveItems(fileIds, folderIds, targetFolderId, userId) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");

            const promises = [];

            if (fileIds && fileIds.length > 0) {
                const filePlaceholders = fileIds.map(() => '?').join(',');
                const moveFilesSql = `UPDATE files SET folder_id = ? WHERE message_id IN (${filePlaceholders}) AND user_id = ?`;
                promises.push(new Promise((res, rej) => {
                    db.run(moveFilesSql, [targetFolderId, ...fileIds, userId], (err) => err ? rej(err) : res());
                }));
            }

            if (folderIds && folderIds.length > 0) {
                const folderPlaceholders = folderIds.map(() => '?').join(',');
                const moveFoldersSql = `UPDATE folders SET parent_id = ? WHERE id IN (${folderPlaceholders}) AND user_id = ?`;
                 promises.push(new Promise((res, rej) => {
                    db.run(moveFoldersSql, [targetFolderId, ...folderIds, userId], (err) => err ? rej(err) : res());
                }));
            }

            Promise.all(promises)
                .then(() => {
                    db.run("COMMIT;", (err) => {
                        if (err) reject(err);
                        else resolve({ success: true });
                    });
                })
                .catch((err) => {
                    db.run("ROLLBACK;", () => reject(err));
                });
        });
    });
}

function deleteSingleFolder(folderId, userId) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM folders WHERE id = ? AND user_id = ?`;
        db.run(sql, [folderId, userId], function(err) {
            if (err) return reject(err);
            resolve({ success: true, changes: this.changes });
        });
    });
}

async function getFolderDeletionData(folderId, userId) {
    let filesToDelete = [];
    let foldersToDeleteIds = [folderId];

    async function findContentsRecursive(currentFolderId) {
        const sqlFiles = `SELECT * FROM files WHERE folder_id = ? AND user_id = ?`;
        const files = await new Promise((res, rej) => db.all(sqlFiles, [currentFolderId, userId], (err, rows) => err ? rej(err) : res(rows)));
        filesToDelete.push(...files);
        
        const sqlFolders = `SELECT id FROM folders WHERE parent_id = ? AND user_id = ?`;
        const subFolders = await new Promise((res, rej) => db.all(sqlFolders, [currentFolderId, userId], (err, rows) => err ? rej(err) : res(rows)));
        
        for (const subFolder of subFolders) {
            foldersToDeleteIds.push(subFolder.id);
            await findContentsRecursive(subFolder.id);
        }
    }

    await findContentsRecursive(folderId);

    const allUserFolders = await getAllFolders(userId);
    const folderMap = new Map(allUserFolders.map(f => [f.id, f]));
    
    function buildPath(fId) {
        let pathParts = [];
        let current = folderMap.get(fId);
        while(current && current.parent_id) {
            pathParts.unshift(current.name);
            current = folderMap.get(current.parent_id);
        }
        return '/' + pathParts.join('/');
    }

    const foldersToDeleteWithPaths = foldersToDeleteIds.map(id => ({
        id: id,
        path: buildPath(id)
    }));

    return { files: filesToDelete, folders: foldersToDeleteWithPaths };
}


function executeDeletion(fileIds, folderIds, userId) {
    return new Promise((resolve, reject) => {
        if (fileIds.length === 0 && folderIds.length === 0) return resolve({ success: true });
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");
            const promises = [];
            
            if (fileIds.length > 0) {
                const filePlaceholders = fileIds.map(() => '?').join(',');
                const sql = `DELETE FROM files WHERE message_id IN (${filePlaceholders}) AND user_id = ?`;
                promises.push(new Promise((res, rej) => db.run(sql, [...fileIds, userId], (err) => err ? rej(err) : res())));
            }
            if (folderIds.length > 0) {
                const folderPlaceholders = folderIds.map(() => '?').join(',');
                const sql = `DELETE FROM folders WHERE id IN (${folderPlaceholders}) AND user_id = ?`;
                promises.push(new Promise((res, rej) => db.run(sql, [...folderIds, userId], (err) => err ? rej(err) : res())));
            }

            Promise.all(promises)
                .then(() => db.run("COMMIT;", (err) => err ? reject(err) : resolve({ success: true })))
                .catch((err) => db.run("ROLLBACK;", () => reject(err)));
        });
    });
}


function addFile(fileData, folderId = 1, userId, storageType) {
    const { message_id, fileName, mimetype, file_id, thumb_file_id, date, size } = fileData;
    const sql = `INSERT INTO files (message_id, fileName, mimetype, file_id, thumb_file_id, date, size, folder_id, user_id, storage_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [message_id, fileName, mimetype, file_id, thumb_file_id, date, size, folderId, userId, storageType], function(err) {
            if (err) reject(err);
            else resolve({ success: true, id: this.lastID, fileId: this.lastID });
        });
    });
}

function getFilesByIds(messageIds, userId) {
    if (!messageIds || messageIds.length === 0) {
        return Promise.resolve([]);
    }
    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `SELECT * FROM files WHERE message_id IN (${placeholders}) AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.all(sql, [...messageIds, userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getFileByShareToken(token) {
     return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM files WHERE share_token = ?";
        db.get(sql, [token], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            if (row.share_expires_at && Date.now() > row.share_expires_at) {
                const updateSql = "UPDATE files SET share_token = NULL, share_expires_at = NULL WHERE message_id = ?";
                db.run(updateSql, [row.message_id]);
                resolve(null);
            } else {
                resolve(row);
            }
        });
    });
}

function getFolderByShareToken(token) {
     return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM folders WHERE share_token = ?";
        db.get(sql, [token], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            if (row.share_expires_at && Date.now() > row.share_expires_at) {
                const updateSql = "UPDATE folders SET share_token = NULL, share_expires_at = NULL WHERE id = ?";
                db.run(updateSql, [row.id]);
                resolve(null);
            } else {
                resolve(row);
            }
        });
    });
}

function findFileInSharedFolder(fileId, folderToken) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT f.*
            FROM files f
            JOIN folders fo ON f.folder_id = fo.id
            WHERE f.message_id = ? AND fo.share_token = ?
        `;
        db.get(sql, [fileId, folderToken], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function renameFile(messageId, newFileName, userId) {
    const sql = `UPDATE files SET fileName = ? WHERE message_id = ? AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [newFileName, messageId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '文件未找到。' });
            else resolve({ success: true });
        });
    });
}

function renameFolder(folderId, newFolderName, userId) {
    const sql = `UPDATE folders SET name = ? WHERE id = ? AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [newFolderName, folderId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '资料夹未找到。' });
            else resolve({ success: true });
        });
    });
}

function createShareLink(itemId, itemType, expiresIn, userId) {
    const token = crypto.randomBytes(16).toString('hex');
    let expiresAt = null;
    const now = Date.now();
    const hours = (h) => h * 60 * 60 * 1000;
    const days = (d) => d * 24 * hours(1);
    switch (expiresIn) {
        case '1h': expiresAt = now + hours(1); break;
        case '3h': expiresAt = now + hours(3); break;
        case '5h': expiresAt = now + hours(5); break;
        case '7h': expiresAt = now + hours(7); break;
        case '24h': expiresAt = now + hours(24); break;
        case '7d': expiresAt = now + days(7); break;
        case '0': expiresAt = null; break;
        default: expiresAt = now + hours(24);
    }

    const table = itemType === 'folder' ? 'folders' : 'files';
    const idColumn = itemType === 'folder' ? 'id' : 'message_id';

    const sql = `UPDATE ${table} SET share_token = ?, share_expires_at = ? WHERE ${idColumn} = ? AND user_id = ?`;

    return new Promise((resolve, reject) => {
        db.run(sql, [token, expiresAt, itemId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '项目未找到。' });
            else resolve({ success: true, token });
        });
    });
}

function deleteFilesByIds(messageIds, userId) {
    if (!messageIds || messageIds.length === 0) {
        return Promise.resolve({ success: true, changes: 0 });
    }
    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `DELETE FROM files WHERE message_id IN (${placeholders}) AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [...messageIds, userId], function(err) {
            if (err) reject(err);
            else resolve({ success: true, changes: this.changes });
        });
    });
}

function getActiveShares(userId) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        const sqlFiles = `SELECT message_id as id, fileName as name, 'file' as type, share_token, share_expires_at FROM files WHERE share_token IS NOT NULL AND (share_expires_at IS NULL OR share_expires_at > ?) AND user_id = ?`;
        const sqlFolders = `SELECT id, name, 'folder' as type, share_token, share_expires_at FROM folders WHERE share_token IS NOT NULL AND (share_expires_at IS NULL OR share_expires_at > ?) AND user_id = ?`;

        let shares = [];
        db.all(sqlFiles, [now, userId], (err, files) => {
            if (err) return reject(err);
            shares = shares.concat(files);
            db.all(sqlFolders, [now, userId], (err, folders) => {
                if (err) return reject(err);
                shares = shares.concat(folders);
                resolve(shares);
            });
        });
    });
}

function cancelShare(itemId, itemType, userId) {
    const table = itemType === 'folder' ? 'folders' : 'files';
    const idColumn = itemType === 'folder' ? 'id' : 'message_id';
    const sql = `UPDATE ${table} SET share_token = NULL, share_expires_at = NULL WHERE ${idColumn} = ? AND user_id = ?`;

    return new Promise((resolve, reject) => {
        db.run(sql, [itemId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '项目未找到或无需取消' });
            else resolve({ success: true });
        });
    });
}

async function getConflictingItems(itemNames, targetFolderId, userId) {
    if (!itemNames || itemNames.length === 0) {
        return [];
    }
    const uniqueNames = [...new Set(itemNames)];
    const placeholders = uniqueNames.map(() => '?').join(',');

    const sqlFiles = `
        SELECT fileName as name, 'file' as type FROM files
        WHERE folder_id = ? AND user_id = ? AND fileName IN (${placeholders})
    `;
    const sqlFolders = `
        SELECT name, 'folder' as type FROM folders
        WHERE parent_id = ? AND user_id = ? AND name IN (${placeholders})
    `;

    const fileConflictsPromise = new Promise((resolve, reject) => {
        db.all(sqlFiles, [targetFolderId, userId, ...uniqueNames], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });

    const folderConflictsPromise = new Promise((resolve, reject) => {
        db.all(sqlFolders, [targetFolderId, userId, ...uniqueNames], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });

    try {
        const [fileConflicts, folderConflicts] = await Promise.all([fileConflictsPromise, folderConflictsPromise]);
        return [...fileConflicts, ...folderConflicts];
    } catch (error) {
        console.error("Error in getConflictingItems:", error);
        throw error;
    }
}


function checkFullConflict(name, folderId, userId) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT name FROM (
                SELECT name FROM folders WHERE name = ? AND parent_id = ? AND user_id = ?
                UNION ALL
                SELECT fileName as name FROM files WHERE fileName = ? AND folder_id = ? AND user_id = ?
            ) LIMIT 1
        `;
        db.get(sql, [name, folderId, userId, name, folderId, userId], (err, row) => {
            if (err) return reject(err);
            resolve(!!row);
        });
    });
}

function findFileInFolder(fileName, folderId, userId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT message_id FROM files WHERE fileName = ? AND folder_id = ? AND user_id = ?`;
        db.get(sql, [fileName, folderId, userId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

// --- 新生：扫描专用函数 ---
function findFileByFileId(fileId, userId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT message_id FROM files WHERE file_id = ? AND user_id = ?`;
        db.get(sql, [fileId, userId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

// 修：新增函数以直接获取根目录
function getRootFolder(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT id FROM folders WHERE user_id = ? AND parent_id IS NULL", [userId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function findOrCreateFolderByPath(fullPath, userId) {
    // 修：确保能正确处理根目录 (fullPath 为 '/' 或 '')
    if (!fullPath || fullPath === '/') {
        const root = await getRootFolder(userId);
        return root.id;
    }

    const pathParts = fullPath.split('/').filter(p => p);
    let parentId = (await getRootFolder(userId)).id;

    for (const part of pathParts) {
        let folder = await findFolderByName(part, parentId, userId);
        if (folder) {
            parentId = folder.id;
        } else {
            console.log(`Creating folder '${part}' inside parent folder ${parentId} for user ${userId}`);
            const result = await createFolder(part, parentId, userId);
            parentId = result.id;
        }
    }
    return parentId;
}

async function resolvePathToFolderId(startFolderId, pathParts, userId) {
    let currentParentId = startFolderId;
    for (const part of pathParts) {
        if (!part) continue;

        let folder = await new Promise((resolve, reject) => {
            const sql = `SELECT id FROM folders WHERE name = ? AND parent_id = ? AND user_id = ?`;
            db.get(sql, [part, currentParentId, userId], (err, row) => err ? reject(err) : resolve(row));
        });

        if (folder) {
            currentParentId = folder.id;
        } else {
            const newFolder = await new Promise((resolve, reject) => {
                const sql = `INSERT INTO folders (name, parent_id, user_id) VALUES (?, ?, ?)`;
                db.run(sql, [part, currentParentId, userId], function(err) {
                    if (err) return reject(err);
                    resolve({ id: this.lastID });
                });
            });
            currentParentId = newFolder.id;
        }
    }
    return currentParentId;
}

module.exports = {
    createUser,
    findUserByName,
    findUserById,
    changeUserPassword,
    listNormalUsers,
    listAllUsers,
    deleteUser,
    searchItems,
    getFolderContents,
    getFilesRecursive,
    getFolderPath,
    createFolder,
    findFolderByName,
    getAllFolders,
    getAllDescendantFolderIds,
    executeDeletion,
    getFolderDeletionData,
    deleteSingleFolder,
    addFile,
    getFilesByIds,
    getItemsByIds,
    getChildrenOfFolder,
    moveItems,
    moveItem,
    getFileByShareToken,
    getFolderByShareToken,
    findFileInSharedFolder,
    createShareLink,
    getActiveShares,
    cancelShare,
    renameFile,
    renameFolder,
    deleteFilesByIds,
    findFileInFolder,
    getConflictingItems,
    checkFullConflict,
    resolvePathToFolderId,
    findFolderByPath,
    getDescendantFiles,
    // --- 新生导出 ---
    findFileByFileId,
    findOrCreateFolderByPath,
    getRootFolder
};
