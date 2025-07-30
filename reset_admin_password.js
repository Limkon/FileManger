const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const readline = require('readline');

// --- 配置区 ---
// 确保这个使用者名称与您 .env 档案中的 ADMIN_USER 一致
const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
// *** 关键修正：将资料库档名从 'database.db' 改为 'file-manager.db' ***
const DB_PATH = path.join(__dirname, 'data', 'file-manager.db');
// --- 配置区结束 ---

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('\x1b[31m%s\x1b[0m', `[错误] 无法连接到资料库: ${DB_PATH}`);
        console.error('\x1b[31m%s\x1b[0m', err.message);
        console.log('请确认您的专案路径是否正确，以及 `data/file-manager.db` 档案是否存在。');
        return;
    }
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function findUser(username) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function createRootFolder(userId) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO folders (name, parent_id, user_id) VALUES (?, ?, ?)`;
        db.run(sql, ['/', null, userId], function (err) {
            if (err) return reject(err);
            console.log(`已为新管理员 (ID: ${userId}) 建立根目录。`);
            resolve();
        });
    });
}


async function resetOrCreateAdmin() {
    console.log('\x1b[33m%s\x1b[0m', '--- 管理员密码重设与建立工具 ---');
    
    const newPassword = await askQuestion(`请输入管理员 [${ADMIN_USERNAME}] 的新密码 (最少4个字元): `);
    if (!newPassword || newPassword.length < 4) {
        console.error('\x1b[31m%s\x1b[0m', '密码长度不可少于 4 个字元。操作已取消。');
        rl.close();
        db.close();
        return;
    }

    try {
        console.log('正在产生安全的密码杂凑值...');
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        console.log('杂凑值已产生。');

        const existingUser = await findUser(ADMIN_USERNAME);

        if (existingUser) {
            // --- 使用者存在，更新密码 ---
            const sql = `UPDATE users SET password = ?, is_admin = 1 WHERE id = ?`;
            db.run(sql, [hashedPassword, existingUser.id], function(err) {
                if (err) {
                    console.error('\x1b[31m%s\x1b[0m', '更新密码时发生资料库错误:', err.message);
                } else {
                    console.log('\x1b[32m%s\x1b[0m', `✅ 成功！使用者 "${ADMIN_USERNAME}" 的密码已被重设。`);
                    console.log('现在您可以重新启动主程式并使用新密码登入。');
                }
                rl.close();
                db.close();
            });
        } else {
            // --- 使用者不存在，建立新管理员 ---
            const insertSql = `INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)`;
            db.run(insertSql, [ADMIN_USERNAME, hashedPassword], async function(err) {
                if (err) {
                    console.error('\x1b[31m%s\x1b[0m', '建立新管理员时发生资料库错误:', err.message);
                    rl.close();
                    db.close();
                    return;
                }
                const newUserId = this.lastID;
                console.log(`成功建立管理员帐号 "${ADMIN_USERNAME}" (ID: ${newUserId})。`);
                
                // 为新管理员建立根目录
                await createRootFolder(newUserId);
                
                console.log('\x1b[32m%s\x1b[0m', `✅ 成功！管理员帐号已建立并设定好密码。`);
                console.log('现在您可以重新启动主程式并使用新密码登入。');
                rl.close();
                db.close();
            });
        }

    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '处理过程中发生未知错误:', error);
        rl.close();
        db.close();
    }
}

resetOrCreateAdmin();
