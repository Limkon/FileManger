#!/bin/bash

# 设置颜色变量
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}--- 开始安装 Telegram 文件管理器 (手动配置模式) ---${NC}"
echo -e "${RED}================================================================${NC}"
echo -e "${YELLOW}警告：此脚本会将所有项目文件直接解压到您当前的目录中！${NC}"
echo -e "${YELLOW}为安全起见，强烈建议在一个新建的空文件夹中运行此命令。${NC}"
echo -e "${RED}================================================================${NC}"
sleep 5

# 1. 下载并解压项目到当前目录
echo -e "\n${YELLOW}[1/3] 正在下载并解压项目文件...${NC}"
curl -L https://github.com/Nexavor/NetworkFileManger/archive/refs/heads/master.tar.gz | tar -xz --strip-components=1 || { echo -e "${RED}错误：下载或解压失败。${NC}"; exit 1; }

# 2. 安装依赖
echo -e "\n${YELLOW}[2/3] 正在安装 Node.js 依赖...${NC}"
npm install || { echo -e "${RED}错误：'npm install' 失败。${NC}"; exit 1; }

# 3. 修复安全漏洞
echo -e "\n${YELLOW}[3/3] 正在修复 Multer 安全漏洞...${NC}"
npm install multer@1.4.4-lts.1 > /dev/null 2>&1
npm audit fix --force > /dev/null 2>&1

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✅ 基础安装已成功完成！${NC}"
echo -e "${YELLOW}下一步需要您手动完成配置:${NC}"
echo "  1. 请在当前目录下创建一个名为 '.env' 的文件。"
echo "  2. 在文件中填入所有必要的配置，例如："
echo "     BOT_TOKEN=your_token"
echo "     CHANNEL_ID=your_channel_id"
echo "     ADMIN_USER=admin"
echo "     ADMIN_PASS=your_password"
echo "     SESSION_SECRET=your_strong_random_secret"
echo "  3. 配置完成后，请直接启动应用:npm start"
echo -e "${GREEN}================================================================${NC}"
