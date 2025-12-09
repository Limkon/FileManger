## ☁️ 通过 Cloudflare Dashboard 手动上传部署或github导入

可以直接通过 Cloudflare 网页控制台完成部署。这种方式非常直观，适合手动发布。
# 支持webdav/S3/telegram,打造属于自己的专属网盘。
## 受限于Cloudflare的内存和CPU的限制无法完成在线打包，所以不支持文件夹下载。
### 1. 准备工作
    * 登录 Cloudflare Dashboard。
    * 在左侧菜单 Workers & Pages-> KV 中，创建一个命名空间（建议命名：netdrv-kv）。
    * 在左侧菜单 Workers & Pages -> D1 中，创建一个数据库（建议命名：netfile-db）。

### 2. 创建项目并上传代码
1.  进入 **Workers & Pages** 页面。
2.  点击 **Create application** -> 切换到 **Pages** 标签 -> 点击 **Upload assets**。
3.  输入项目名称，点击 **Create project**。
4.  在 **"Upload assets"** 步骤，将你准备好的文件夹内的**所有文件**拖入上传区域。
5.  点击 **Deploy site**。
    > ⚠️ **注意**：此时虽然显示部署成功，但网站还无法正常运行（会报错 500），因为尚未绑定数据库和设置兼容性标志。请继续下一步。

### 3. 配置项目设置 (关键步骤)
进入你刚创建的 Pages 项目页面，点击顶部的 **Settings (设置)** 选项卡。

#### A. 设置兼容性标志 (必须)
1.  点击左侧菜单的 **Functions (函数)**。
2.  向下滚动找到 **Compatibility Flags** 区域。
3.  点击 **Configuration** -> **Add compatibility flag**。
4.  输入：`nodejs_compat`
    * *这是后端运行所必需的标志。*
5.  点击 **Save**。

#### B. 绑定存储资源 (必须)
继续在 **Functions** 页面，向下滚动到 **R2, D1, KV binding** 区域。你需要添加以下两个绑定，**变量名称必须严格一致**：

1.  **KV Namespace Bindings**:
    * 点击 **Add binding**。
    * **Variable name (变量名)**: `CONFIG_KV`
    * **KV Namespace**: 选择你在第 1 步创建的 KV（如 `netdrv-kv`）。
    * 点击 **Save**。

2.  **D1 Database Bindings**:
    * 点击 **Add binding**。
    * **Variable name (变量名)**: `DB`
    * **D1 Database**: 选择你在第 1 步创建的 D1 数据库（如 `netfile-db`）。
    * 点击 **Save**。

#### C. 设置环境变量
1.  点击左侧菜单的 **Environment variables (环境变量)**。
2.  点击 **Add variable**。
3.  添加变量：
    * **Variable name**: `SESSION_SECRET`
    * **Value**: (输入一段随机的长字符串，用于加密用户会话)
4.  点击 **Save**。

### 4. 重新部署 (让配置生效)
修改了绑定和配置后，必须重新部署一次才能生效。
1.  点击顶部的 **Deployments (部署)** 选项卡。
2.  点击 **Create new deployment**。
3.  **再次上传** 同样的构建文件夹。
4.  等待部署完成。

### 5. 初始化数据库
1.  部署成功后，在浏览器访问初始化页面：
    `https://您的项目域名.pages.dev/setup`
    *(注意：是 `/setup` 路径，不是首页)*
2.  如果配置正确，页面将显示 **"✅ 初始化成功: 账号 admin / 密码 admin"** 或 **"✅ 系统已就緒"**。

### 6. 开始使用
现在您可以访问首页 `/` 并登录了。
* **默认账号**: `admin`
* **默认密码**: `admin`
* *请登录后立即在设置中修改密码。*
### 7. 重置账户密码
执行 SQL 语句
登陆 Cloudflare Dashboard，进入 D1 数据库 Console 控制台，执行以下 SQL   
```bash
UPDATE users SET password = '$2a$10$KgtZ.y6HUmQBTRUA0FVKqO5s0esptlR5HupHYvgh.H.g7gpDkPDl.' WHERE username = 'admin'
```  
可将密码重置为账号 admin / 密码 admin

### 8. 重置加密文件夹密码
执行 SQL 语句
登陆 Cloudflare Dashboard，进入 D1 数据库 Console 控制台，执行以下 SQL   
```bash
SELECT id, name, user_id FROM folders WHERE name = '你的加密文件夹名称'
```
获得文件夹ID   
```bash
UPDATE folders SET password = NULL WHERE id = 文件夹ID
```   
可清除密码
