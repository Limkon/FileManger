const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'file-manager.db');

// 确保资料目录存在
try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }
} catch (error) {
    console.error(`[致命错误] 无法创建资料夹: ${DATA_DIR}。错误: ${error.message}`);
    process.exit(1);
}

const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('无法连接到数据库:', err.message);
        return;
    }
    console.log('成功连接到 SQLite 资料库。');
    initializeDatabase();
});

function initializeDatabase() {
    db.serialize(() => {
        console.log('开始初始化资料库结构...');

        db.run("PRAGMA foreign_keys = ON;", (err) => {
            if (err) console.error("启用外键约束失败:", err.message);
        });

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            is_admin BOOLEAN NOT NULL DEFAULT 0
        )`, (err) => {
            if (err) {
                console.error("建立 'users' 表失败:", err.message);
            } else {
                console.log("'users' 表已确认存在。");
                // 在 users 表创建成功后，创建其他表
                createDependentTables();
            }
        });
    });
}

function createDependentTables() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            user_id INTEGER NOT NULL,
            share_token TEXT,
            share_expires_at INTEGER,
            FOREIGN KEY (parent_id) REFERENCES folders (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE(name, parent_id, user_id)
        )`, (err) => {
            if (err) console.error("建立 'folders' 表失败:", err.message);
            else console.log("'folders' 表已确认存在。");
        });

        db.run(`CREATE TABLE IF NOT EXISTS files (
            message_id INTEGER PRIMARY KEY,
            fileName TEXT NOT NULL,
            mimetype TEXT,
            file_id TEXT NOT NULL,
            thumb_file_id TEXT,
            size INTEGER,
            date INTEGER NOT NULL,
            share_token TEXT,
            share_expires_at INTEGER,
            folder_id INTEGER NOT NULL DEFAULT 1,
            user_id INTEGER NOT NULL,
            storage_type TEXT NOT NULL DEFAULT 'telegram',
            UNIQUE(fileName, folder_id, user_id),
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`, (err) => {
            if (err) console.error("建立 'files' 表失败:", err.message);
            else {
                console.log("'files' 表已确认存在。");
                // 所有表结构都建立完毕后，再检查并建立管理员帐号
                checkAndCreateAdmin();
            }
        });
    });
}

function checkAndCreateAdmin() {
    console.log("检查管理员帐号...");
    db.get("SELECT * FROM users WHERE is_admin = 1", (err, admin) => {
        if (err) {
            console.error("查询管理员时出错:", err.message);
            return;
        }
        if (!admin) {
            console.log("未找到管理员帐号，正在建立预设管理员...");
            const adminUser = process.env.ADMIN_USER || 'admin';
            const adminPass = process.env.ADMIN_PASS || 'admin';
            const salt = bcrypt.genSaltSync(10);
            const hashedPassword = bcrypt.hashSync(adminPass, salt);

            db.run("INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)", [adminUser, hashedPassword], function(err) {
                if (err) {
                    console.error("建立管理员帐号失败:", err.message);
                    return;
                }
                const adminId = this.lastID;
                console.log(`管理员 '${adminUser}' 建立成功。`);
                
                db.get("SELECT * FROM folders WHERE user_id = ? AND parent_id IS NULL", [adminId], (err, root) => {
                    if (err) {
                        console.error("查询管理员根目录失败:", err.message);
                        return;
                    }
                    if (!root) {
                        db.run("INSERT INTO folders (name, parent_id, user_id) VALUES (?, NULL, ?)", ['/', adminId], (err) => {
                            if(err) console.error("为管理员建立根目录失败:", err.message);
                            else console.log("管理员根目录建立成功。");
                        });
                    }
                });
            });
        } else {
            console.log("管理员帐号已存在。");
        }
    });
}

module.exports = db;
