// public/manager.js - 完整全功能版 (含前端打包下载 & 排序功能)

// =================================================================================
// 1. 全局工具函数 (无依赖，放在最外层)
// =================================================================================

function getIconClass(item) {
    if (item.type === 'folder') return 'fas fa-folder';
    const name = item.name || ''; 
    const ext = name.split('.').pop().toLowerCase();
    
    if (['jpg','jpeg','png','gif','bmp','webp'].includes(ext)) return 'fas fa-file-image';
    if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'fas fa-file-video';
    if (['mp3','wav','ogg','flac'].includes(ext)) return 'fas fa-file-audio';
    if (['pdf'].includes(ext)) return 'fas fa-file-pdf';
    if (['zip','rar','7z','tar','gz'].includes(ext)) return 'fas fa-file-archive';
    if (['txt','md','js','html','css','json','py','java','c','cpp','h','xml','log','ini','conf'].includes(ext)) return 'fas fa-file-alt';
    return 'fas fa-file';
}

function getItemId(item) { 
    return item.type === 'file' ? `file:${item.message_id}` : `folder:${item.id}`; 
}

function parseItemId(str) { 
    if (!str) return [null, null];
    const p = str.split(':'); 
    return [p[0], p[1]]; 
}

function escapeHtml(text) { 
    if (!text) return ''; 
    return text.replace(/[&<>"']/g, m => ({ 
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' 
    })[m]); 
}

function formatSize(bytes) { 
    if (bytes === 0 || bytes === undefined) return '0 B'; 
    const k = 1024; 
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']; 
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; 
}

// 获取显示名称，将 "/" 转换为 "根目录"
function getDisplayName(name) {
    return (name === '/' || name === 'root') ? '根目录' : name;
}

// =================================================================================
// 2. 主程序逻辑
// =================================================================================
document.addEventListener('DOMContentLoaded', () => {
    
    // --- 变量声明 ---
    let currentFolderId = null; 
    let currentPath = [];       
    let items = [];             
    let selectedItems = new Set(); 
    let isMultiSelectMode = false; 
    let viewMode = localStorage.getItem('viewMode') || 'grid'; 
    let isTrashMode = false;
    
    // 排序状态：默认按名称升序
    let sortState = { field: 'name', direction: 'asc' };

    // 冲突解决状态
    let conflictResolutionState = { applyToAll: false, choice: null };
    
    let selectedMoveTargetId = null;
    
    // 临时存储当前正在尝试解锁的文件夹 ID
    let pendingUnlockFolderId = null; 

    // --- DOM 引用 ---
    const itemGrid = document.getElementById('itemGrid');
    const itemListView = document.getElementById('itemListView');
    const itemListBody = document.getElementById('itemListBody');
    const breadcrumb = document.getElementById('breadcrumb');
    const searchInput = document.getElementById('searchInput');
    const searchForm = document.getElementById('searchForm');
    
    const taskStatusBar = document.getElementById('taskStatusBar');
    const taskIcon = document.getElementById('taskIcon');
    const taskText = document.getElementById('taskText');
    const taskProgress = document.getElementById('taskProgress');

    const uploadModal = document.getElementById('uploadModal');
    const uploadForm = document.getElementById('uploadForm');
    const folderSelect = document.getElementById('folderSelect');
    const progressBar = document.getElementById('progressBar');
    const progressArea = document.getElementById('progressArea');
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    
    let uploadStatusText = document.getElementById('uploadStatusText');
    if (!uploadStatusText && progressArea) {
        uploadStatusText = document.createElement('div');
        uploadStatusText.id = 'uploadStatusText';
        uploadStatusText.style.textAlign = 'center';
        uploadStatusText.style.fontSize = '12px';
        uploadStatusText.style.marginTop = '5px';
        progressArea.appendChild(uploadStatusText);
    }
    
    const quotaUsedEl = document.getElementById('quotaUsed');
    const quotaMaxEl = document.getElementById('quotaMax');
    const quotaBar = document.getElementById('quotaBar');
    
    const contextMenu = document.getElementById('contextMenu');
    const ctxCreateFolderBtn = document.getElementById('ctxCreateFolderBtn');
    const ctxCreateFileBtn = document.getElementById('ctxCreateFileBtn');
    
    const editBtn = document.getElementById('editBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const openBtn = document.getElementById('openBtn');
    const previewBtn = document.getElementById('previewBtn');
    const lockBtn = document.getElementById('lockBtn');
    const renameBtn = document.getElementById('renameBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    const viewSwitchBtn = document.getElementById('view-switch-btn');
    const trashBtn = document.getElementById('trashBtn'); 
    const trashBanner = document.getElementById('trashBanner'); 
    const emptyTrashBtn = document.getElementById('emptyTrashBtn'); 
    const restoreBtn = document.getElementById('restoreBtn'); 
    const deleteForeverBtn = document.getElementById('deleteForeverBtn'); 
    const dropZoneOverlay = document.getElementById('dropZoneOverlay');

    const moveModal = document.getElementById('moveModal');
    const moveBtn = document.getElementById('moveBtn');
    const folderTree = document.getElementById('folderTree');
    const confirmMoveBtn = document.getElementById('confirmMoveBtn');
    const cancelMoveBtn = document.getElementById('cancelMoveBtn');

    const shareModal = document.getElementById('shareModal');
    const shareBtn = document.getElementById('shareBtn');
    const confirmShareBtn = document.getElementById('confirmShareBtn');
    const cancelShareBtn = document.getElementById('cancelShareBtn');
    const closeShareModalBtn = document.getElementById('closeShareModalBtn');
    const expiresInSelect = document.getElementById('expiresInSelect');
    const customExpiresInput = document.getElementById('customExpiresInput');
    const sharePasswordInput = document.getElementById('sharePasswordInput');
    const shareResult = document.getElementById('shareResult');
    const shareOptions = document.getElementById('shareOptions');
    const shareLinkContainer = document.getElementById('shareLinkContainer');
    const copyLinkBtn = document.getElementById('copyLinkBtn');

    const previewModal = document.getElementById('previewModal');
    const modalContent = document.getElementById('modalContent');
    const closePreviewBtn = document.querySelector('#previewModal .close-button');

    const conflictModal = document.getElementById('conflictModal');
    const conflictMessage = document.getElementById('conflictMessage');
    const applyToAllCheckbox = document.getElementById('applyToAllCheckbox');
    const conflictRenameBtn = document.getElementById('conflictRenameBtn');
    const conflictOverwriteBtn = document.getElementById('conflictOverwriteBtn');
    const conflictSkipBtn = document.getElementById('conflictSkipBtn');
    const conflictCancelBtn = document.getElementById('conflictCancelBtn');

    // 修改密码相关 DOM
    const changePasswordModal = document.getElementById('changePasswordModal');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const closeChangePasswordBtn = document.getElementById('closeChangePasswordBtn');
    const submitChangePasswordBtn = document.getElementById('submitChangePasswordBtn');
    const oldPasswordInput = document.getElementById('oldPasswordInput');
    const newPasswordInput = document.getElementById('newPasswordInput');
    
    // 解锁文件夹 DOM
    const unlockModal = document.getElementById('unlockModal');
    const unlockForm = document.getElementById('unlockForm');
    const unlockPasswordInput = document.getElementById('unlockPasswordInput');

    // --- 函数定义区 ---

    // 1. 任务管理器
    const TaskManager = {
        timer: null,
        show: (text, iconClass = 'fas fa-spinner') => {
            if (TaskManager.timer) clearTimeout(TaskManager.timer);
            if(taskStatusBar) taskStatusBar.classList.add('active');
            if(taskText) taskText.textContent = text;
            if(taskIcon) { taskIcon.className = `task-icon spinning ${iconClass}`; taskIcon.classList.add('spinning'); }
            if(taskProgress) taskProgress.style.width = '0%';
        },
        update: (percent, text) => {
            if(taskProgress) taskProgress.style.width = percent + '%';
            if(text && taskText) taskText.textContent = text;
        },
        success: (text = '完成') => {
            if(taskText) taskText.textContent = text;
            if(taskIcon) { taskIcon.className = 'task-icon fas fa-check-circle'; taskIcon.style.color = '#28a745'; }
            if(taskProgress) taskProgress.style.width = '100%';
            TaskManager.hide(2000);
        },
        error: (text = '失败') => {
            if(taskText) taskText.textContent = text;
            if(taskIcon) { taskIcon.className = 'task-icon fas fa-times-circle'; taskIcon.style.color = '#dc3545'; }
            TaskManager.hide(3000);
        },
        hide: (delay = 0) => {
            TaskManager.timer = setTimeout(() => {
                if(taskStatusBar) taskStatusBar.classList.remove('active');
                setTimeout(() => {
                    if(taskIcon) { taskIcon.style.color = ''; taskIcon.classList.remove('spinning'); }
                }, 300);
            }, delay);
        }
    };

    // 2. 冲突解决弹窗函数
    function showConflictModal(message) {
        return new Promise((resolve) => {
            conflictMessage.textContent = message;
            conflictModal.style.display = 'block';
            
            if (applyToAllCheckbox) applyToAllCheckbox.checked = false;

            const cleanup = () => {
                conflictModal.style.display = 'none';
                conflictRenameBtn.onclick = null;
                conflictOverwriteBtn.onclick = null;
                conflictSkipBtn.onclick = null;
                conflictCancelBtn.onclick = null;
            };

            const handleChoice = (choice) => {
                const applyToAll = applyToAllCheckbox ? applyToAllCheckbox.checked : false;
                cleanup();
                resolve({ choice, applyToAll });
            };

            conflictRenameBtn.onclick = () => handleChoice('rename');
            conflictOverwriteBtn.onclick = () => handleChoice('overwrite');
            conflictSkipBtn.onclick = () => handleChoice('skip');
            conflictCancelBtn.onclick = () => handleChoice('cancel');
        });
    }

    // 3. 右键菜单逻辑
    function showContextMenu(x, y) {
        if(!contextMenu) return;
        const menuWidth = 200; 
        const menuHeight = isTrashMode ? 80 : 350; 
        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
        
        contextMenu.style.top = `${y}px`;
        contextMenu.style.left = `${x}px`;
        contextMenu.style.display = 'flex';
        
        setTimeout(() => {
            document.addEventListener('click', () => {
                contextMenu.style.display = 'none';
            }, { once: true });
        }, 50);
    }

    function updateContextMenuState(hasSelection) {
        const count = selectedItems.size;
        const isSingle = count === 1;
        let firstType = null;
        if (isSingle) {
            const idStr = Array.from(selectedItems)[0];
            [firstType] = parseItemId(idStr);
        }

        const globalActions = document.querySelectorAll('.global-action');
        const itemActions = document.querySelectorAll('.item-action');

        if (isTrashMode) {
            globalActions.forEach(el => el.style.display = 'none');
            itemActions.forEach(el => {
                if (el.id === 'deleteBtn') {
                    el.style.display = hasSelection ? 'flex' : 'none';
                    el.innerHTML = '<i class="fas fa-trash-restore"></i> 还原 / 删除';
                } else {
                    el.style.display = 'none';
                }
            });
            return;
        }

        if (hasSelection) {
            globalActions.forEach(el => el.style.display = 'none');
            itemActions.forEach(el => el.style.display = 'flex');
            
            const setDisplay = (id, show) => {
                const btn = document.getElementById(id);
                if (btn) btn.style.display = show ? 'flex' : 'none';
            };
            
            // 只要选中项包含文件，就显示下载按钮（支持批量）
            const selectionHasFile = Array.from(selectedItems).some(id => id.startsWith('file:'));
            
            setDisplay('openBtn', isSingle && firstType === 'folder');
            setDisplay('previewBtn', isSingle && firstType === 'file');
            setDisplay('editBtn', isSingle && firstType === 'file'); 
            setDisplay('downloadBtn', true); // [修改] 始终显示下载按钮，支持文件夹下载
            setDisplay('renameBtn', isSingle);
            setDisplay('shareBtn', isSingle);
            setDisplay('moveBtn', true); 
            setDisplay('lockBtn', isSingle && firstType === 'folder');
            
            const delBtn = document.getElementById('deleteBtn');
            if(delBtn) delBtn.innerHTML = '<i class="fas fa-trash-alt"></i> 删除';
        } else {
            globalActions.forEach(el => el.style.display = 'flex');
            itemActions.forEach(el => el.style.display = 'none');
        }
        
        const infoEl = document.getElementById('selectionInfo');
        if(infoEl) {
            if (count > 0) {
                infoEl.style.display = 'block';
                infoEl.textContent = `已选中 ${count} 个项目`;
            } else {
                infoEl.style.display = 'none';
            }
        }
    }

    function handleContextMenu(e, item) {
        e.preventDefault();
        e.stopPropagation();
        
        const id = getItemId(item);
        if (!selectedItems.has(id)) {
            if (!isMultiSelectMode && !e.ctrlKey) {
                selectedItems.clear();
                document.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            }
            selectedItems.add(id);
            const gridEl = document.querySelector(`.grid-item[data-id="${id}"]`);
            if(gridEl) gridEl.classList.add('selected');
            const listEl = document.querySelector(`.list-row[data-id="${id}"]`);
            if(listEl) listEl.classList.add('selected');
        }
        
        updateContextMenuState(true);
        showContextMenu(e.clientX, e.clientY);
    }

    // 4. 渲染函数
    function createGridItem(item) {
        const div = document.createElement('div');
        div.className = 'grid-item item-card';
        if(isTrashMode) div.classList.add('deleted');
        div.dataset.id = getItemId(item);
        
        div.onclick = (e) => handleItemClick(e, item, div);
        div.oncontextmenu = (e) => handleContextMenu(e, item);
        div.ondblclick = () => handleItemDblClick(item);

        const iconClass = getIconClass(item);
        const iconColor = item.type === 'folder' ? '#fbc02d' : '#007bff';

        // --- 缩略图逻辑 ---
        let iconContent = `<i class="${iconClass}" style="color: ${iconColor};"></i>`;
        
        if (!isTrashMode && item.type === 'file' && item.mimetype) {
            const thumbUrl = `/api/thumbnail/${item.message_id}`;
            if (item.mimetype.startsWith('image/')) {
                iconContent = `<img src="${thumbUrl}" loading="lazy" alt="${escapeHtml(item.name)}" style="width:100%; height:100%; object-fit: cover; border-radius: 4px;" onerror="this.onerror=null; this.parentNode.innerHTML='<i class=\\'${iconClass}\\' style=\\'color: ${iconColor};\\'></i>'">`;
            } else if (item.mimetype.startsWith('video/')) {
                iconContent = `<video src="${thumbUrl}#t=0.1" preload="metadata" muted style="width:100%; height:100%; object-fit: cover; border-radius: 4px;" onloadeddata="this.pause()" onerror="this.onerror=null; this.parentNode.innerHTML='<i class=\\'${iconClass}\\' style=\\'color: ${iconColor};\\'></i>'"></video>`;
            }
        }

        div.innerHTML = `
            <div class="item-icon">${iconContent}${item.is_locked ? '<i class="fas fa-lock lock-badge"></i>' : ''}</div>
            <div class="item-info"><h5 title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h5></div>
            ${isMultiSelectMode ? '<div class="select-checkbox"><i class="fas fa-check"></i></div>' : ''}
        `;
        if (selectedItems.has(getItemId(item))) div.classList.add('selected');
        return div;
    }

    function createListItem(item) {
        const tr = document.createElement('tr');
        tr.className = 'list-row list-item';
        if(isTrashMode) tr.classList.add('deleted');
        tr.dataset.id = getItemId(item);
        
        tr.onclick = (e) => handleItemClick(e, item, tr);
        tr.oncontextmenu = (e) => handleContextMenu(e, item);
        tr.ondblclick = () => handleItemDblClick(item);

        const iconClass = getIconClass(item);
        const dateStr = item.date ? new Date(item.date).toLocaleString() : (item.deleted_at ? new Date(item.deleted_at).toLocaleString() : '-');
        const sizeStr = item.size !== undefined ? formatSize(item.size) : '-';

        tr.innerHTML = `
            <td><div class="list-icon"><i class="${iconClass}" style="color: ${item.type === 'folder' ? '#fbc02d' : '#555'}"></i></div></td>
            <td><div class="list-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div></td>
            <td>${sizeStr}</td>
            <td>${dateStr}</td>
        `;
        if (selectedItems.has(getItemId(item))) tr.classList.add('selected');
        return tr;
    }

    function renderItems(itemsToRender) {
        if(itemGrid) itemGrid.innerHTML = '';
        if(itemListBody) itemListBody.innerHTML = '';
        if (itemsToRender.length === 0) {
            if(itemGrid) itemGrid.innerHTML = '<div class="empty-folder" style="text-align:center; padding:50px; color:#999;"><i class="fas fa-folder-open" style="font-size:48px; margin-bottom:10px;"></i><p>此位置为空</p></div>';
            if(itemListBody) itemListBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#999;">为空</td></tr>`;
            return;
        }
        itemsToRender.forEach(item => {
            if(itemGrid) itemGrid.appendChild(createGridItem(item));
            if(itemListBody) itemListBody.appendChild(createListItem(item));
        });
    }

    // 5. 其他逻辑函数
    
    // 排序核心逻辑
    function applySort() {
        if (!items || items.length === 0) {
            renderItems([]);
            return;
        }

        items.sort((a, b) => {
            let valA, valB;
            
            // 提取比较值
            if (sortState.field === 'name') {
                valA = a.name || '';
                valB = b.name || '';
                // 中文名称排序
                return sortState.direction === 'asc' 
                    ? valA.localeCompare(valB, "zh-CN", { numeric: true }) 
                    : valB.localeCompare(valA, "zh-CN", { numeric: true });
            } 
            else if (sortState.field === 'size') {
                // 文件夹在前，同类型按大小
                if (a.type !== b.type) {
                     return a.type === 'folder' ? -1 : 1;
                }
                valA = a.size || 0;
                valB = b.size || 0;
            } 
            else if (sortState.field === 'date') {
                valA = new Date(a.date || a.deleted_at || 0).getTime();
                valB = new Date(b.date || b.deleted_at || 0).getTime();
            }

            // 通用数字比较
            if (valA < valB) return sortState.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortState.direction === 'asc' ? 1 : -1;
            return 0;
        });

        renderItems(items);
        updateSortIcons();
    }

    // 更新表头图标 UI
    function updateSortIcons() {
        document.querySelectorAll('.sortable').forEach(th => {
            const field = th.dataset.sort;
            const icon = th.querySelector('.sort-icon');
            
            if (!icon) return;

            // 重置样式
            th.classList.remove('active');
            icon.className = 'fas fa-sort sort-icon'; // 默认双向箭头

            // 设置当前激活项
            if (field === sortState.field) {
                th.classList.add('active');
                if (sortState.direction === 'asc') {
                    icon.className = 'fas fa-sort-up sort-icon';
                } else {
                    icon.className = 'fas fa-sort-down sort-icon';
                }
            }
        });
    }

    async function updateQuota() {
        try {
            const res = await axios.get('/api/user/quota');
            const { max, used } = res.data;
            if (quotaUsedEl) quotaUsedEl.textContent = formatSize(used);
            if (quotaMaxEl) quotaMaxEl.textContent = max == 0 ? '无限' : formatSize(max);
            if (quotaBar) {
                if (max > 0) {
                    const percent = Math.min(100, (used / max) * 100);
                    quotaBar.style.width = percent + '%';
                } else {
                    quotaBar.style.width = '0%'; 
                }
            }
        } catch (e) {
            console.error('更新配额失败:', e);
        }
    }

    function updateFolderSelectForUpload(folders) {
        if(!folderSelect) return;
        // 修改：使用 getDisplayName 显示根目录
        const rootName = getDisplayName('/'); 
        folderSelect.innerHTML = `<option value="${currentFolderId}">当前文件夹</option>`;
        items.forEach(item => {
            if(item.type === 'folder') {
                const op = document.createElement('option');
                op.value = item.encrypted_id;
                op.textContent = getDisplayName(item.name);
                folderSelect.appendChild(op);
            }
        });
    }

    function renderBreadcrumb() {
        if(isTrashMode) return; 
        if(!breadcrumb) return;
        breadcrumb.innerHTML = '';
        
        // 修改：根节点文字改为 "根目录"
        const rootLi = document.createElement('a');
        rootLi.href = '#';
        rootLi.innerHTML = '<i class="fas fa-home"></i> 根目录';
        
        rootLi.onclick = (e) => { e.preventDefault(); if(currentPath.length > 0) loadFolder(currentPath[0].encrypted_id); };
        breadcrumb.appendChild(rootLi);
        
        // 修改：从索引 1 开始遍历，跳过已被手动添加的根目录
        for (let i = 1; i < currentPath.length; i++) {
            const folder = currentPath[i];
            const sep = document.createElement('span');
            sep.className = 'separator'; sep.textContent = '/';
            breadcrumb.appendChild(sep);
            
            const a = document.createElement('a');
            a.textContent = getDisplayName(folder.name); // 使用格式化后的名称
            
            if (i === currentPath.length - 1) { 
                a.classList.add('active'); 
            } else { 
                a.href = '#'; 
                a.onclick = (e) => { e.preventDefault(); loadFolder(folder.encrypted_id); }; 
            }
            breadcrumb.appendChild(a);
        }
    }

    async function loadFolder(encryptedId) {
        if (!encryptedId && !isTrashMode) return;
        isTrashMode = false;
        if(trashBanner) trashBanner.style.display = 'none';
        selectedItems.clear();
        updateContextMenuState(false);
        try {
            const res = await axios.get(`/api/folder/${encryptedId}?t=${Date.now()}`);
            const data = res.data;
            items = [...data.contents.folders, ...data.contents.files];
            currentPath = data.path;
            renderBreadcrumb();
            
            // 在渲染前应用排序
            applySort();

            updateFolderSelectForUpload(data.contents.folders);
            const newUrl = `/view/${encryptedId}`;
            if (window.location.pathname !== newUrl) {
                window.history.pushState({ id: encryptedId }, '', newUrl);
            }
            currentFolderId = encryptedId;
            if (searchInput) searchInput.value = '';
        } catch (error) {
            // --- 核心修复：捕获 403 锁定错误 ---
            if (error.response && error.response.status === 403 && error.response.data.error === 'LOCKED') {
                pendingUnlockFolderId = encryptedId;
                if(unlockModal) {
                    unlockModal.style.display = 'block';
                    if(unlockPasswordInput) {
                        unlockPasswordInput.value = '';
                        unlockPasswordInput.focus();
                    }
                }
                return; // 停止加载，等待用户解锁
            }
            // ------------------------------------

            console.error(error);
            const msg = error.response?.data?.message || error.message;
            if (error.response && error.response.status === 400 && msg.includes('无效 ID')) {
                 window.location.href = '/'; 
                 return;
            }
            if(itemGrid) itemGrid.innerHTML = `<div class="error-msg" style="text-align:center; padding:20px; color:#dc3545;">加载失败: ${msg}</div>`;
        }
    }

    async function loadTrash() {
        isTrashMode = true;
        currentFolderId = null;
        selectedItems.clear();
        updateContextMenuState(false);
        if(trashBanner) trashBanner.style.display = 'flex';
        
        breadcrumb.innerHTML = `
            <span><i class="fas fa-trash-restore"></i> 回收站</span>
            <a href="#" id="exitTrashLink" style="margin-left:15px; font-size:0.9rem; color:#007bff; text-decoration:none; cursor:pointer;">
                <i class="fas fa-sign-out-alt"></i> 退出回收站
            </a>
        `;
        
        setTimeout(() => {
            const exitLink = document.getElementById('exitTrashLink');
            if(exitLink) {
                exitLink.onclick = (e) => {
                    e.preventDefault();
                    window.location.reload(); 
                };
            }
        }, 0);
        
        try {
            const res = await axios.get('/api/trash');
            items = [...res.data.folders, ...res.data.files];
            renderItems(items);
        } catch (e) {
            alert('加载回收站失败: ' + (e.response?.data?.message || e.message));
        }
    }

    function handleItemClick(e, item, el) {
        const id = getItemId(item);
        if (e.ctrlKey || isMultiSelectMode) {
            if (selectedItems.has(id)) { selectedItems.delete(id); el.classList.remove('selected'); } 
            else { selectedItems.add(id); el.classList.add('selected'); }
        } else {
            document.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            selectedItems.clear(); selectedItems.add(id); el.classList.add('selected');
        }
        updateContextMenuState(true);
    }

    function handleItemDblClick(item) {
        if(isTrashMode) return;
        if (item.type === 'folder') { loadFolder(item.encrypted_id); } 
        else { 
            TaskManager.show('正在请求下载...', 'fas fa-download');
            setTimeout(() => TaskManager.success('下载已开始'), 2000);
            const ext = item.name ? item.name.split('.').pop().toLowerCase() : '';
            if (['txt', 'md', 'js', 'html', 'css', 'json', 'xml', 'py', 'java', 'c', 'cpp', 'h', 'log', 'ini', 'conf'].includes(ext)) {
                 window.open(`/editor.html?id=${item.message_id}&name=${encodeURIComponent(item.name)}`, '_blank');
            } else { window.open(`/download/proxy/${item.message_id}`, '_blank'); }
        }
    }

    // --- 事件绑定区 ---
    
    // 表头排序点击事件
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (sortState.field === field) {
                // 如果点击当前排序列，切换方向
                sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                // 如果点击新列，默认升序
                sortState.field = field;
                sortState.direction = 'asc';
            }
            applySort();
        });
    });

    // 背景右键
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            selectedItems.clear();
            document.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            updateContextMenuState(false);
            showContextMenu(e.clientX, e.clientY);
        });
    }

    if(trashBtn) trashBtn.addEventListener('click', loadTrash);
    if(emptyTrashBtn) emptyTrashBtn.addEventListener('click', async () => {
        if(confirm('确定要清空回收站吗？此操作无法撤销。')) {
            try {
                TaskManager.show('正在清空回收站...');
                await axios.post('/api/trash/empty');
                TaskManager.success('回收站已清空');
                loadTrash();
                updateQuota();
            } catch(e) { TaskManager.error('清空失败'); alert('操作失败'); }
        }
    });

    if(ctxCreateFolderBtn) ctxCreateFolderBtn.addEventListener('click', async () => {
        const name = prompt('请输入新文件夹名称:');
        if (name && name.trim()) {
            try {
                await axios.post('/api/folder/create', { name: name.trim(), parentId: currentFolderId });
                loadFolder(currentFolderId);
            } catch (error) { alert('创建失败'); }
        }
    });

    if(ctxCreateFileBtn) ctxCreateFileBtn.addEventListener('click', async () => {
        const filename = prompt('请输入文件名 (例如: note.txt):', 'new_file.txt');
        if (!filename || !filename.trim()) return;
        const emptyFile = new File([""], filename.trim(), { type: "text/plain" });
        const fileObj = { file: emptyFile, path: '' };
        await executeUpload([fileObj], currentFolderId);
    });

    if(deleteBtn) deleteBtn.addEventListener('click', async () => {
        if (selectedItems.size === 0) return;
        if (isTrashMode) {
            alert('请使用顶部的「还原」或「永久删除」按钮进行操作。');
            return;
        }
        if (!confirm(`确定要删除选中的 ${selectedItems.size} 个项目吗？`)) return;
        const files = []; const folders = [];
        selectedItems.forEach(id => { const [type, realId] = parseItemId(id); if (type === 'file') files.push(realId); else folders.push(realId); });
        try { 
            TaskManager.show('正在删除...', 'fas fa-trash');
            await axios.post('/api/delete', { files, folders, permanent: false }); 
            selectedItems.clear(); 
            loadFolder(currentFolderId); 
            updateQuota(); 
            TaskManager.success('删除成功');
        } catch (error) { TaskManager.error('删除失败'); alert('删除失败'); }
    });

    if(restoreBtn) restoreBtn.addEventListener('click', async () => {
        if (selectedItems.size === 0) return alert('请先选择要还原的项目');
        
        const files = []; const folders = [];
        selectedItems.forEach(id => { 
            const [type, realId] = parseItemId(id); 
            if (type === 'file') files.push(realId); 
            else folders.push(realId); 
        });

        let conflictMode = 'rename'; 

        try {
            TaskManager.show('正在检查冲突...', 'fas fa-spinner');
            const checkRes = await axios.post('/api/trash/check', { files, folders });
            const { conflicts } = checkRes.data;

            if (conflicts && conflicts.length > 0) {
                const conflictNames = conflicts.slice(0, 3).join(', ');
                const moreText = conflicts.length > 3 ? ` 等 ${conflicts.length} 个项目` : '';
                const msg = `还原的目标位置已存在同名项目: "${conflictNames}"${moreText}。`;

                const result = await showConflictModal(msg);
                
                if (result.choice === 'cancel') {
                    TaskManager.hide();
                    return;
                }
                conflictMode = result.choice;
            }

            TaskManager.show('正在还原...', 'fas fa-trash-restore');
            await axios.post('/api/trash/restore', { 
                files, 
                folders, 
                conflictMode: conflictMode 
            }); 
            
            selectedItems.clear(); 
            loadTrash(); 
            updateQuota(); 
            TaskManager.success('还原成功');
        } catch (error) { 
            TaskManager.error('还原失败'); 
            alert('还原失败: ' + (error.response?.data?.message || error.message)); 
        }
    });

    if(deleteForeverBtn) deleteForeverBtn.addEventListener('click', async () => {
        if (selectedItems.size === 0) return alert('请先选择要删除的项目');
        if (!confirm('确定要永久删除吗？此操作无法撤销！')) return;
        const files = []; const folders = [];
        selectedItems.forEach(id => { const [type, realId] = parseItemId(id); if (type === 'file') files.push(realId); else folders.push(realId); });
        try { 
            TaskManager.show('正在永久删除...', 'fas fa-times');
            await axios.post('/api/delete', { files, folders, permanent: true }); 
            selectedItems.clear(); 
            loadTrash(); 
            updateQuota(); 
            TaskManager.success('已永久删除');
        } catch (error) { TaskManager.error('操作失败'); alert('永久删除失败'); }
    });

    if(renameBtn) renameBtn.addEventListener('click', async () => {
        if (selectedItems.size !== 1) return;
        const idStr = Array.from(selectedItems)[0]; const [type, id] = parseItemId(idStr); const item = items.find(i => getItemId(i) === idStr);
        if (!item) return;
        const newName = prompt('重命名:', item.name);
        if (newName && newName !== item.name) {
            try { await axios.post('/api/rename', { type, id, name: newName }); loadFolder(currentFolderId); } catch (error) { alert('重命名失败'); }
        }
    });
    
    // --- [修改] 下载功能：支持文件夹前端打包 ---
    if(downloadBtn) downloadBtn.addEventListener('click', async () => {
        if (selectedItems.size === 0) return;

        // 1. 区分选中的是单文件还是包含文件夹/多文件
        const selectedList = [];
        selectedItems.forEach(idStr => {
            const [type, id] = parseItemId(idStr);
            const item = items.find(i => getItemId(i) === idStr);
            if (item) selectedList.push({ type, id, item });
        });

        // 场景一：单文件直接下载 (速度最快)
        if (selectedList.length === 1 && selectedList[0].type === 'file') {
            const item = selectedList[0].item;
            TaskManager.show('正在请求下载...', 'fas fa-download');
            setTimeout(() => TaskManager.success('下载已开始'), 1500);
            window.open(`/download/proxy/${item.message_id}`, '_blank');
            return;
        }

        // 场景二：多文件或包含文件夹 -> 前端打包下载
        if (!confirm(`即将打包下载 ${selectedList.length} 个项目。\n\n注意：\n1. 文件夹会被递归打包。\n2. 文件过多过大可能会消耗较多浏览器内存。\n\n是否继续？`)) return;

        try {
            // A. 递归获取所有文件信息
            TaskManager.show('正在扫描文件结构...', 'fas fa-search');
            const filesToZip = []; // 格式: { name: "path/to/file.txt", url: "..." }

            // 递归遍历函数
            async function traverse(targetId, targetType, currentPath, targetName) {
                if (targetType === 'file') {
                    // 如果是文件，直接加入列表
                    filesToZip.push({
                        path: currentPath + targetName,
                        id: targetId
                    });
                } else {
                    // 如果是文件夹，调用 API 获取内容
                    const folderPath = currentPath + targetName + '/';
                    try {
                        // 使用现有的 API 获取文件夹内容
                        const res = await axios.get(`/api/folder/${targetId}?t=${Date.now()}`);
                        const contents = res.data.contents;
                        
                        // 递归处理子文件
                        for (const f of contents.files) {
                            filesToZip.push({
                                path: folderPath + f.name,
                                id: f.message_id // 注意：文件下载用 message_id
                            });
                        }
                        // 递归处理子文件夹
                        for (const d of contents.folders) {
                            await traverse(d.encrypted_id, 'folder', folderPath, d.name);
                        }
                    } catch (e) {
                        console.error(`读取文件夹 ${targetName} 失败:`, e);
                        // 可以选择跳过或报错
                    }
                }
            }

            // 开始遍历选中项
            for (const itemObj of selectedList) {
                await traverse(itemObj.id, itemObj.type, '', itemObj.item.name);
            }

            if (filesToZip.length === 0) {
                TaskManager.error('没有可下载的文件');
                return;
            }

            // B. 开始下载并压缩
            const zip = new JSZip();
            let downloadedCount = 0;
            const total = filesToZip.length;

            TaskManager.show(`准备下载 ${total} 个文件...`, 'fas fa-file-archive');

            // 串行下载以保证稳定性 (如果追求速度可改为 Promise.all 批量并发)
            for (let i = 0; i < total; i++) {
                const fileInfo = filesToZip[i];
                TaskManager.show(`[${i+1}/${total}] 下载中: ${fileInfo.path.split('/').pop()}`, 'fas fa-download');
                TaskManager.update(Math.round(((i) / total) * 100));

                try {
                    // 请求文件 Blob 数据
                    const response = await axios.get(`/download/proxy/${fileInfo.id}`, { 
                        responseType: 'blob' 
                    });
                    
                    // 添加到 ZIP 对象
                    zip.file(fileInfo.path, response.data);
                    downloadedCount++;
                } catch (e) {
                    console.error(`下载文件 ${fileInfo.path} 失败`, e);
                    zip.file(fileInfo.path + ".error.txt", "下载失败: " + e.message);
                }
            }

            // C. 生成 ZIP 文件
            TaskManager.show('正在打包压缩...', 'fas fa-cog fa-spin');
            
            const zipContent = await zip.generateAsync({ 
                type: "blob",
                compression: "DEFLATE", // 启用压缩
                compressionOptions: { level: 5 } // 压缩等级 1-9
            }, (metadata) => {
                // 压缩进度更新
                TaskManager.update(metadata.percent.toFixed(0), `压缩中 ${metadata.percent.toFixed(0)}%`);
            });

            // D. 触发保存
            const zipFilename = selectedList.length === 1 ? `${selectedList[0].item.name}.zip` : `batch_download_${Date.now()}.zip`;
            saveAs(zipContent, zipFilename);
            
            TaskManager.success('打包下载完成');

        } catch (error) {
            console.error(error);
            TaskManager.error('打包失败: ' + error.message);
            alert('打包下载过程中出错，请查看控制台。');
        }
    });

    if(editBtn) editBtn.addEventListener('click', async () => {
        if (selectedItems.size !== 1) return;
        const idStr = Array.from(selectedItems)[0]; 
        const [type, id] = parseItemId(idStr); 
        const item = items.find(i => getItemId(i) === idStr);
        
        if (type !== 'file' || !item) return;

        const editableExtensions = ['txt', 'md', 'js', 'html', 'css', 'json', 'xml', 'py', 'java', 'c', 'cpp', 'h', 'log', 'ini', 'conf'];
        const ext = item.name ? item.name.split('.').pop().toLowerCase() : '';
        
        if (editableExtensions.includes(ext)) {
             window.open(`/editor.html?id=${item.message_id}&name=${encodeURIComponent(item.name)}`, '_blank');
        } else {
             alert('此文件类型不支持在线编辑');
        }
    });

    if(openBtn) openBtn.addEventListener('click', () => {
         if (selectedItems.size !== 1) return;
         const idStr = Array.from(selectedItems)[0]; const [type, id] = parseItemId(idStr);
         if (type === 'folder') {
             const item = items.find(i => getItemId(i) === idStr);
             if(item) loadFolder(item.encrypted_id);
         }
    });
    
    if(previewBtn) previewBtn.addEventListener('click', async () => {
        if (selectedItems.size !== 1) return;
        const idStr = Array.from(selectedItems)[0]; const [type, id] = parseItemId(idStr); const item = items.find(i => getItemId(i) === idStr);
        if (!item || type !== 'file') return;
        const ext = item.name.split('.').pop().toLowerCase();
        const downloadUrl = `/download/proxy/${id}`;
        
        TaskManager.show('正在加载预览...', 'fas fa-eye');
        let content = '';
        if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) content = `<img src="${downloadUrl}" style="max-width:100%; max-height:80vh;">`;
        else if (['mp4','webm'].includes(ext)) content = `<video src="${downloadUrl}" controls style="max-width:100%; max-height:80vh;"></video>`;
        else if (['mp3','wav','ogg','flac'].includes(ext)) content = `<audio src="${downloadUrl}" controls></audio>`;
        else if (['txt','md','json','js','css','html','xml','log'].includes(ext)) {
             try {
                 if(modalContent) modalContent.innerHTML = '<p>正在加载...</p>'; 
                 if(previewModal) previewModal.style.display = 'flex';
                 const res = await axios.get(downloadUrl, { responseType: 'text' });
                 content = `<pre>${escapeHtml(res.data)}</pre>`;
             } catch(e) { content = `<p style="color:red">无法预览: ${e.message}</p>`; }
        } else content = `<div class="no-preview"><i class="fas fa-file" style="font-size:48px;margin-bottom:20px;"></i><p>不支持预览</p><a href="${downloadUrl}" class="upload-link-btn">下载文件</a></div>`;
        
        TaskManager.success('预览就绪');
        if(modalContent) modalContent.innerHTML = content; 
        if(previewModal) previewModal.style.display = 'flex';
    });
    if(closePreviewBtn) closePreviewBtn.onclick = () => previewModal.style.display = 'none';
    
    if(lockBtn) lockBtn.addEventListener('click', async () => {
        if (selectedItems.size !== 1) return;
        const idStr = Array.from(selectedItems)[0]; const [type, id] = parseItemId(idStr);
        if (type !== 'folder') return;
        
        const item = items.find(i => getItemId(i) === idStr);
        
        let oldPassword = '';
        let newPassword = '';

        // 分情况处理交互逻辑
        if (item.is_locked) {
            // 情况 A: 文件夹已加密 -> 需要先验证原密码
            oldPassword = prompt('【安全验证】\n该文件夹已加密，请先输入原密码进行验证:');
            if (oldPassword === null) return; // 用户点击取消
            if (!oldPassword) return alert('原密码不能为空');

            newPassword = prompt('【验证通过】\n- 输入新密码可修改\n- 留空并确定将【移除密码】(解密文件夹):');
            if (newPassword === null) return; // 用户点击取消
        } else {
            // 情况 B: 文件夹未加密 -> 直接设置新密码
            newPassword = prompt('设置文件夹密码:');
            if (newPassword === null) return; // 用户点击取消
        }

        try { 
            // 发送请求，包含 oldPassword (如果是加密状态)
            await axios.post('/api/folder/lock', { 
                folderId: item.encrypted_id, 
                password: newPassword,
                oldPassword: oldPassword 
            }); 
            
            if (item.is_locked && !newPassword) {
                alert('密码已移除，文件夹已解密。');
            } else if (item.is_locked && newPassword) {
                alert('密码修改成功。');
            } else {
                alert('文件夹加密成功。');
            }
            loadFolder(currentFolderId); 
        } catch (e) { 
            alert('操作失败: ' + (e.response?.data?.message || e.message)); 
        }
    });

    if(viewSwitchBtn) viewSwitchBtn.addEventListener('click', () => {
        viewMode = viewMode === 'grid' ? 'list' : 'grid';
        localStorage.setItem('viewMode', viewMode);
        updateViewModeUI();
        renderItems(items);
    });
    
    if(searchForm) searchForm.addEventListener('submit', async (e) => {
        e.preventDefault(); const q = searchInput.value.trim(); if(!q) return loadFolder(currentFolderId);
        try {
            const res = await axios.get(`/api/search?q=${encodeURIComponent(q)}`);
            items = [...res.data.folders, ...res.data.files];
            renderItems(items);
            if(breadcrumb) breadcrumb.innerHTML = '<span><i class="fas fa-search"></i> 搜索结果</span><a href="#" onclick="location.reload()" style="margin-left:10px;">退出搜索</a>';
        } catch(e) { alert('搜索失败'); }
    });

    if(document.getElementById('logoutBtn')) document.getElementById('logoutBtn').addEventListener('click', () => window.location.href = '/logout');
    
    if(document.getElementById('multiSelectToggleBtn')) document.getElementById('multiSelectToggleBtn').addEventListener('click', () => {
        isMultiSelectMode = !isMultiSelectMode;
        document.body.classList.toggle('selection-mode-active', isMultiSelectMode);
        document.getElementById('multiSelectToggleBtn').classList.toggle('active', isMultiSelectMode);
        renderItems(items); if(contextMenu) contextMenu.style.display = 'none';
    });
    
    if(document.getElementById('selectAllBtn')) document.getElementById('selectAllBtn').addEventListener('click', () => {
        if (selectedItems.size === items.length) { selectedItems.clear(); document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected')); } 
        else { items.forEach(item => selectedItems.add(getItemId(item))); document.querySelectorAll('.item-card, .list-item').forEach(el => el.classList.add('selected')); }
        updateContextMenuState(true); if(contextMenu) contextMenu.style.display = 'none';
    });

    if(shareBtn) {
        shareBtn.addEventListener('click', () => {
            if (selectedItems.size !== 1) return alert('一次只能分享一个项目');
            shareModal.style.display = 'block';
            if(shareOptions) shareOptions.style.display = 'block';
            if(shareResult) shareResult.style.display = 'none';
            if(sharePasswordInput) sharePasswordInput.value = '';
            if(expiresInSelect) expiresInSelect.value = '24h';
            if(customExpiresInput) customExpiresInput.style.display = 'none';
        });
    }

    if(closeShareModalBtn) closeShareModalBtn.addEventListener('click', () => shareModal.style.display = 'none');
    if(cancelShareBtn) cancelShareBtn.addEventListener('click', () => shareModal.style.display = 'none');

    if(expiresInSelect) expiresInSelect.addEventListener('change', (e) => {
        if(customExpiresInput) customExpiresInput.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    if(confirmShareBtn) confirmShareBtn.addEventListener('click', async () => {
        const itemStr = Array.from(selectedItems)[0];
        const [type, id] = parseItemId(itemStr); 
        const password = sharePasswordInput ? sharePasswordInput.value : '';
        const expiresIn = expiresInSelect ? expiresInSelect.value : '24h';
        
        let customExpiresAt = null;
        if (expiresIn === 'custom' && customExpiresInput) {
            const val = customExpiresInput.value;
            if (!val) return alert('请选择过期时间');
            customExpiresAt = new Date(val).getTime();
        }

        try {
            confirmShareBtn.disabled = true;
            confirmShareBtn.textContent = '生成中...';
            const res = await axios.post('/api/share/create', { itemId: id, itemType: type, expiresIn, password, customExpiresAt });
            if (res.data.success) {
                if(shareOptions) shareOptions.style.display = 'none';
                if(shareResult) shareResult.style.display = 'block';
                const fullLink = window.location.origin + res.data.link;
                if(shareLinkContainer) shareLinkContainer.textContent = fullLink;
                if(copyLinkBtn) copyLinkBtn.dataset.link = fullLink;
            } else { alert('生成失败: ' + res.data.message); }
        } catch (e) { alert('请求失败: ' + e.message); } 
        finally { confirmShareBtn.disabled = false; confirmShareBtn.textContent = '生成链接'; }
    });

    if(copyLinkBtn) copyLinkBtn.addEventListener('click', () => {
        const link = copyLinkBtn.dataset.link;
        navigator.clipboard.writeText(link).then(() => {
            const originalText = copyLinkBtn.textContent;
            copyLinkBtn.textContent = '已复制!';
            copyLinkBtn.classList.add('success-btn');
            setTimeout(() => { copyLinkBtn.textContent = originalText; copyLinkBtn.classList.remove('success-btn'); }, 2000);
        });
    });

    // 移动功能
    if (moveBtn) {
        moveBtn.addEventListener('click', () => {
            if (selectedItems.size === 0) return;
            selectedMoveTargetId = null;
            confirmMoveBtn.disabled = true;
            moveModal.style.display = 'block';
            loadFolderTree();
        });
    }
    
    if(cancelMoveBtn) cancelMoveBtn.addEventListener('click', () => moveModal.style.display = 'none');

    async function loadFolderTree() {
        if(folderTree) folderTree.innerHTML = '<div style="padding:10px;color:#666;">加载中...</div>';
        try {
            const res = await axios.get('/api/folders');
            renderFolderTree(res.data);
        } catch (e) {
            if(folderTree) folderTree.innerHTML = `<div style="color:red;padding:10px;">加载失败: ${e.message}</div>`;
        }
    }

    function renderFolderTree(folders) {
        const movingFolderIds = new Set();
        selectedItems.forEach(itemStr => {
            const [type, id] = parseItemId(itemStr);
            if (type === 'folder') {
                const matched = folders.find(f => f.encrypted_id === id || f.id == id);
                if(matched) movingFolderIds.add(matched.id);
            }
        });

        const map = {};
        let root = null;
        folders.forEach(f => { f.children = []; map[f.id] = f; });
        folders.forEach(f => {
            if (f.parent_id && map[f.parent_id]) map[f.parent_id].children.push(f);
            else if(!root) root = f; 
        });
        if (!root && folders.length > 0) root = folders[0]; 

        folderTree.innerHTML = '';
        if (root) folderTree.appendChild(createFolderNode(root, movingFolderIds));
        else folderTree.innerHTML = '<div style="padding:10px;">没有文件夹</div>';
    }

    function createFolderNode(folder, movingIds) {
        const container = document.createElement('div');
        const itemDiv = document.createElement('div');
        itemDiv.className = 'folder-item';
        const isSelf = movingIds.has(folder.id);
        const displayName = getDisplayName(folder.name); 

        if (isSelf) {
            itemDiv.style.color = '#999';
            itemDiv.style.cursor = 'not-allowed';
            itemDiv.innerHTML = `<i class="fas fa-folder" style="margin-right:5px;"></i> ${escapeHtml(displayName)} (当前)`;
        } else {
            itemDiv.innerHTML = `<i class="fas fa-folder" style="margin-right:5px;"></i> ${escapeHtml(displayName)}`;
            itemDiv.onclick = () => {
                document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('selected'));
                itemDiv.classList.add('selected');
                selectedMoveTargetId = folder.encrypted_id;
                confirmMoveBtn.disabled = false;
            };
        }
        container.appendChild(itemDiv);
        if (folder.children && folder.children.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.style.paddingLeft = '20px';
            folder.children.forEach(child => {
                const childNode = createFolderNode(child, movingIds);
                if(isSelf) {
                    const childItemDiv = childNode.querySelector('.folder-item');
                    if(childItemDiv) {
                        childItemDiv.style.color = '#999';
                        childItemDiv.style.cursor = 'not-allowed';
                        childItemDiv.onclick = null;
                    }
                }
                childrenContainer.appendChild(childNode);
            });
            container.appendChild(childrenContainer);
        }
        return container;
    }

    if(confirmMoveBtn) confirmMoveBtn.addEventListener('click', async () => {
        if (!selectedMoveTargetId) return;
        
        const files = []; const folders = [];
        const moveItemNames = []; 
        
        selectedItems.forEach(id => { 
            const [type, realId] = parseItemId(id); 
            const originalItem = items.find(i => getItemId(i) === id);
            if (originalItem) {
                if (type === 'file') { 
                    files.push(realId); 
                } else { 
                    folders.push(realId); 
                }
                moveItemNames.push({ type, name: originalItem.name });
            }
        });
        
        try {
            confirmMoveBtn.textContent = '正在检查冲突...';
            confirmMoveBtn.disabled = true;
            
            // 1. 获取目标文件夹内容进行比对 (验重)
            const targetRes = await axios.get(`/api/folder/${selectedMoveTargetId}?t=${Date.now()}`);
            const targetContents = targetRes.data.contents;
            
            const targetFileNames = new Set(targetContents.files.map(f => f.fileName));
            const targetFolderNames = new Set(targetContents.folders.map(f => f.name));
            
            // 2. 筛选出冲突项
            const conflicts = moveItemNames.filter(item => {
                if (item.type === 'file') {
                    return targetFileNames.has(item.name);
                } else {
                    return targetFolderNames.has(item.name);
                }
            });
            
            let conflictMode = 'rename'; 
            
            if (conflicts.length > 0) {
                // 3. 如果有冲突，显示弹窗让用户选择
                const conflictNames = conflicts.map(c => c.name).slice(0, 3).join(', ');
                const moreText = conflicts.length > 3 ? ` 等 ${conflicts.length} 个项目` : '';
                const msg = `目标位置已存在同名项目: "${conflictNames}"${moreText}。`;
                
                const result = await showConflictModal(msg);
                
                if (result.choice === 'cancel') {
                    confirmMoveBtn.textContent = '确定移动';
                    confirmMoveBtn.disabled = false;
                    moveModal.style.display = 'none';
                    return;
                }
                conflictMode = result.choice;
            }

            // 4. 执行移动
            confirmMoveBtn.textContent = '移动中...';
            TaskManager.show('正在移动...', 'fas fa-arrows-alt'); 
            
            await axios.post('/api/move', { 
                files, folders, targetFolderId: selectedMoveTargetId, conflictMode: conflictMode 
            });
            
            TaskManager.success('移动完成');
            moveModal.style.display = 'none';
            selectedItems.clear();
            loadFolder(currentFolderId);
        } catch (e) {
            alert('移动失败: ' + (e.response?.data?.message || e.message));
            TaskManager.error('移动失败');
        } finally {
            confirmMoveBtn.textContent = '确定移动';
            confirmMoveBtn.disabled = false;
        }
    });

    // 上传功能
    async function getFolderContentsForUpload(encryptedId) {
        try {
            const res = await axios.get(`/api/folder/${encryptedId}?t=${Date.now()}`);
            return res.data.contents;
        } catch (e) { return { folders: [], files: [] }; }
    }

    async function ensureRemotePath(pathStr, rootId) {
        if (!pathStr || pathStr === '' || pathStr === '.') return rootId;
        const parts = pathStr.split('/').filter(p => p.trim() !== '');
        let currentId = rootId;
        for (const part of parts) {
            const contents = await getFolderContentsForUpload(currentId);
            const existingFolder = contents.folders.find(f => f.name === part);
            if (existingFolder) {
                currentId = existingFolder.encrypted_id;
                TaskManager.show(`进入目录: ${part}`, 'fas fa-folder-open');
            } else {
                TaskManager.show(`创建目录: ${part}`, 'fas fa-folder-plus');
                try {
                    // 注意：这里的 parentId 需要是加密 ID
                    await axios.post('/api/folder/create', { name: part, parentId: currentId });
                    
                    // 需要重新查询以获取新创建文件夹的加密 ID
                    const updatedContents = await getFolderContentsForUpload(currentId);
                    const newFolder = updatedContents.folders.find(f => f.name === part);
                    
                    if (newFolder) currentId = newFolder.encrypted_id;
                    else throw new Error(`无法获取新创建目录 ID: ${part}`);
                } catch (e) { throw e; }
            }
        }
        return currentId;
    }

    // --- 修复：修复拖拽上传无法同时上传多个文件的问题 ---
    async function scanDataTransferItems(items) {
        async function scanEntry(entry, path = '') {
            if (entry.isFile) {
                return new Promise((resolve) => {
                    entry.file((file) => {
                        resolve([{
                            file: file,
                            path: path
                        }]);
                    });
                });
            } else if (entry.isDirectory) {
                const dirReader = entry.createReader();
                const currentPath = path ? `${path}/${entry.name}` : entry.name;
                
                // 递归读取目录内容
                const readAllEntries = async () => {
                    return new Promise((resolve, reject) => {
                        let entries = [];
                        const read = () => {
                            dirReader.readEntries(results => {
                                if (!results.length) {
                                    resolve(entries);
                                } else {
                                    entries = entries.concat(results);
                                    read();
                                }
                            }, reject);
                        };
                        read();
                    });
                };

                let allEntries = [];
                try {
                    allEntries = await readAllEntries();
                } catch (e) {
                    /* 忽略读取错误 */
                }

                let files = [];
                for (const subEntry of allEntries) {
                    const subFiles = await scanEntry(subEntry, currentPath);
                    files = files.concat(subFiles);
                }
                return files;
            }
            return [];
        }

        // 1. 同步提取所有 Entry 对象，防止 DataTransferItem 在第一个 await 后失效
        const entries = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item.getAsEntry ? item.getAsEntry() : null);
                if (entry) {
                    entries.push(entry);
                }
            }
        }

        // 2. 异步处理提取出的 Entry 数组
        let files = [];
        for (const entry of entries) {
            const entryFiles = await scanEntry(entry, '');
            files = files.concat(entryFiles);
        }
        
        return files;
    }
    // ----------------------------------------------------

    async function executeUpload(inputItems, targetEncryptedId) {
        if (!inputItems || inputItems.length === 0) return alert('请选择至少一个文件');
        const rootId = targetEncryptedId || currentFolderId;
        let queue = [];
        if (inputItems instanceof FileList) {
            for(let i=0; i<inputItems.length; i++) queue.push({ file: inputItems[i], path: '' });
        } else if (Array.isArray(inputItems)) {
            queue = inputItems;
        }
        if (queue.length === 0) return;

        if(uploadModal) {
            // 关闭上传窗口，使用右下角任务栏显示进度
            uploadModal.style.display = 'none';
        }
        
        if(document.getElementById('uploadForm')) document.getElementById('uploadForm').style.display = 'block';
        if(progressArea) progressArea.style.display = 'none';
        
        TaskManager.show('准备上传...', 'fas fa-cloud-upload-alt');

        // 重置冲突解决状态
        conflictResolutionState.applyToAll = false;
        conflictResolutionState.choice = null;

        const totalBytes = queue.reduce((acc, item) => acc + item.file.size, 0);
        let loadedBytesGlobal = 0;
        let successCount = 0;
        let failCount = 0;
        const pathCache = {}; pathCache[''] = rootId;

        for (let i = 0; i < queue.length; i++) {
            const item = queue[i];
            const file = item.file;
            const relPath = item.path || '';
            let targetFolderId = rootId;
            const statusMsg = `[${i + 1}/${queue.length}] 上传: ${file.name}`;
            if(uploadStatusText) uploadStatusText.textContent = statusMsg;
            TaskManager.show(statusMsg, 'fas fa-file-upload');

            try {
                if (pathCache[relPath]) targetFolderId = pathCache[relPath];
                else { targetFolderId = await ensureRemotePath(relPath, rootId); pathCache[relPath] = targetFolderId; }

                // 新逻辑：先验重
                let conflictMode = 'rename'; 
                let shouldUpload = true;

                try {
                    // 发起后端检查
                    const checkRes = await axios.post('/api/file/check', {
                        folderId: targetFolderId, 
                        fileName: file.name
                    });
                    
                    if (checkRes.data.exists) {
                         // 如果存在，处理冲突逻辑
                         if (conflictResolutionState.applyToAll && conflictResolutionState.choice) {
                            conflictMode = conflictResolutionState.choice;
                        } else {
                            const result = await showConflictModal(`目标位置已存在文件: "${file.name}"`);
                            conflictMode = result.choice;
                            if (result.applyToAll) {
                                conflictResolutionState.applyToAll = true;
                                conflictResolutionState.choice = conflictMode;
                            }
                        }
                        
                        if (conflictMode === 'cancel') { failCount += (queue.length - i); break; }
                        if (conflictMode === 'skip') shouldUpload = false;
                    }
                } catch (checkErr) {
                    console.warn('验重请求失败，将尝试直接重命名上传:', checkErr);
                    // 如果验重接口挂了，默认继续上传（后端默认是 rename）
                }

                if (shouldUpload) {
                    const formData = new FormData();
                    formData.append('files', file, file.name);

                    let currentFileLoaded = 0;
                    await axios.post(`/upload?folderId=${targetFolderId || ''}&conflictMode=${conflictMode}`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        onUploadProgress: (p) => {
                            const diff = p.loaded - currentFileLoaded;
                            currentFileLoaded = p.loaded;
                            loadedBytesGlobal += diff;
                            if (totalBytes > 0 && progressBar) {
                                const percent = Math.min(100, Math.round((loadedBytesGlobal * 100) / totalBytes));
                                // 仅更新悬浮窗进度
                                TaskManager.update(percent, statusMsg); 
                            }
                        }
                    });
                    successCount++;
                } else {
                    // 跳过也视为已处理
                }
            } catch (error) { failCount++; }
        }

        let resultMsg = `上传结束。\n成功: ${successCount}\n失败: ${failCount}`;
        if (failCount > 0) alert(resultMsg);
        TaskManager.success('所有文件上传完成');

        setTimeout(() => {
            if(uploadForm) uploadForm.reset();
            if(uploadStatusText) uploadStatusText.textContent = '';
            loadFolder(currentFolderId);
            updateQuota();
        }, 1000);
    }

    // 绑定上传相关事件
    if(document.getElementById('showUploadModalBtn')) {
        document.getElementById('showUploadModalBtn').addEventListener('click', () => {
            if(uploadModal) uploadModal.style.display = 'block';
            if(document.getElementById('uploadForm')) document.getElementById('uploadForm').style.display = 'block';
            if(progressArea) progressArea.style.display = 'none';
            updateFolderSelectForUpload([]);
        });
    }
    
    if(document.getElementById('closeUploadModalBtn')) {
        document.getElementById('closeUploadModalBtn').addEventListener('click', () => {
            if(uploadModal) uploadModal.style.display = 'none';
        });
    }
    
    if(uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            let allItems = [];
            
            // 处理普通文件上传
            if (fileInput.files.length > 0) {
                allItems = allItems.concat(Array.from(fileInput.files).map(f => ({ file: f, path: '' })));
            }
            
            // 处理文件夹上传 (修复后)
            if (folderInput.files.length > 0) {
                allItems = allItems.concat(Array.from(folderInput.files).map(f => {
                    const parts = f.webkitRelativePath.split('/');
                    parts.pop(); 
                    return { 
                        file: f, 
                        path: parts.join('/') 
                    };
                }));
            }
            
            const targetId = folderSelect ? folderSelect.value : currentFolderId;
            await executeUpload(allItems, targetId || currentFolderId);
        });
    }

    // 拖拽逻辑
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; if(dropZoneOverlay) dropZoneOverlay.style.display = 'flex'; });
    window.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter === 0 && dropZoneOverlay) dropZoneOverlay.style.display = 'none'; });
    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        if(dropZoneOverlay) dropZoneOverlay.style.display = 'none';
        
        const items = e.dataTransfer.items;
        if (items && items.length > 0) {
            const files = await scanDataTransferItems(items);
            if (files.length > 0) await executeUpload(files, currentFolderId);
        } else if (e.dataTransfer.files.length > 0) {
            const list = Array.from(e.dataTransfer.files).map(f => ({ file: f, path: '' }));
            await executeUpload(list, currentFolderId);
        }
    });

    function updateViewModeUI() {
        if(!itemGrid || !itemListView) return;
        if (viewMode === 'grid') {
            itemGrid.style.display = 'grid';
            itemListView.style.display = 'none';
            if(viewSwitchBtn) viewSwitchBtn.innerHTML = '<i class="fas fa-list"></i>';
        } else {
            itemGrid.style.display = 'none';
            itemListView.style.display = 'block';
            if(viewSwitchBtn) viewSwitchBtn.innerHTML = '<i class="fas fa-th-large"></i>';
        }
    }

    // --- 修改密码相关逻辑 ---
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (changePasswordModal) {
                changePasswordModal.style.display = 'block';
                if (oldPasswordInput) oldPasswordInput.value = '';
                if (newPasswordInput) newPasswordInput.value = '';
            }
        });
    }

    if (closeChangePasswordBtn) {
        closeChangePasswordBtn.addEventListener('click', () => {
            if (changePasswordModal) changePasswordModal.style.display = 'none';
        });
    }

    if (submitChangePasswordBtn) {
        submitChangePasswordBtn.addEventListener('click', async () => {
            const oldPwd = oldPasswordInput ? oldPasswordInput.value : '';
            const newPwd = newPasswordInput ? newPasswordInput.value : '';
            if (!oldPwd || !newPwd) return alert('请输入旧密码和新密码');

            submitChangePasswordBtn.disabled = true;
            submitChangePasswordBtn.textContent = '提交中...';

            try {
                const res = await axios.post('/api/user/change-password', {
                    oldPassword: oldPwd,
                    newPassword: newPwd
                });
                alert('密码修改成功');
                if (changePasswordModal) changePasswordModal.style.display = 'none';
            } catch (e) {
                alert('修改失败: ' + (e.response?.data?.message || e.message));
            } finally {
                submitChangePasswordBtn.disabled = false;
                submitChangePasswordBtn.textContent = '确认修改';
            }
        });
    }
    
    // --- 解锁文件夹相关逻辑 ---
    if (unlockForm) {
        unlockForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pwd = unlockPasswordInput.value;
            if (!pendingUnlockFolderId) return;

            try {
                await axios.post('/api/folder/auth', {
                    folderId: pendingUnlockFolderId,
                    password: pwd
                });
                // 验证成功，关闭弹窗并重新加载文件夹
                if(unlockModal) unlockModal.style.display = 'none';
                loadFolder(pendingUnlockFolderId);
            } catch (err) {
                alert('解锁失败: ' + (err.response?.data?.message || '密码错误'));
                unlockPasswordInput.value = '';
            }
        });
    }

    // --- 初始化调用 (放在最后) ---
    const initPath = window.location.pathname.split('/');
    if (initPath[1] === 'view' && initPath[2] && initPath[2] !== 'null') {
        currentFolderId = initPath[2];
    }
    
    updateViewModeUI();
    loadFolder(currentFolderId);
    updateQuota();
});
