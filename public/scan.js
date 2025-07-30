document.addEventListener('DOMContentLoaded', () => {
    const userSelect = document.getElementById('user-select');
    const scanLocalBtn = document.getElementById('scan-local-btn');
    const scanWebdavBtn = document.getElementById('scan-webdav-btn');
    const scanLog = document.getElementById('scan-log');

    // 加载所有使用者到下拉选单
    async function loadUsers() {
        try {
            const response = await axios.get('/api/admin/all-users');
            userSelect.innerHTML = '<option value="" disabled selected>-- 请选择一个使用者 --</option>';
            response.data.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.username;
                userSelect.appendChild(option);
            });
        } catch (error) {
            logMessage('无法加载使用者列表: ' + (error.response?.data?.message || error.message), 'error');
        }
    }

    function logMessage(message, type = 'info') {
        const line = document.createElement('div');
        line.className = `log-${type}`;
        line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        scanLog.appendChild(line);
        scanLog.scrollTop = scanLog.scrollHeight;
    }

    function disableButtons(disabled) {
        scanLocalBtn.disabled = disabled;
        scanWebdavBtn.disabled = disabled;
        userSelect.disabled = disabled;
    }

    async function startScan(storageType) {
        const userId = userSelect.value;
        if (!userId) {
            alert('请先选择一个要汇入的使用者！');
            return;
        }
        
        scanLog.innerHTML = '';
        logMessage(`开始扫描 ${storageType.toUpperCase()} 储存，为使用者 ID: ${userId}`, 'info');
        disableButtons(true);

        try {
            const response = await axios.post(`/api/scan/${storageType}`, { userId });
            const logs = response.data.log;
            logs.forEach(log => logMessage(log.message, log.type));
            logMessage('扫描完成！', 'success');

        } catch (error) {
            logMessage('扫描时发生严重错误: ' + (error.response?.data?.message || error.message), 'error');
        } finally {
            disableButtons(false);
        }
    }

    scanLocalBtn.addEventListener('click', () => startScan('local'));
    scanWebdavBtn.addEventListener('click', () => startScan('webdav'));

    loadUsers();
});
