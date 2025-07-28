// storage/index.js
const telegramStorage = require('./telegram');
const localStorage = require('./local');
const webdavStorage = require('./webdav'); // 新增
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const rawData = fs.readFileSync(CONFIG_FILE);
            const config = JSON.parse(rawData);
            if (!config.webdav) config.webdav = []; // 確保 webdav 設定存在
            return config;
        }
    } catch (error) {
        console.error("讀取設定檔失敗:", error);
    }
    return { storageMode: 'telegram', webdav: [] }; // 預設值
}

function writeConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error("寫入設定檔失敗:", error);
        return false;
    }
}

let config = readConfig();

function getStorage() {
    config = readConfig(); 
    if (config.storageMode === 'local') {
        return localStorage;
    }
    if (config.storageMode === 'webdav') { // 新增
        return webdavStorage;
    }
    return telegramStorage;
}

function setStorageMode(mode) {
    if (['local', 'telegram', 'webdav'].includes(mode)) { // 新增
        config.storageMode = mode;
        return writeConfig(config);
    }
    return false;
}

module.exports = {
    getStorage,
    setStorageMode,
    readConfig,
    writeConfig // 匯出 writeConfig
};
