#!/bin/bash

# 設置顏色變量
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}--- 開始安裝 Telegram 文件管理器 (手動配置模式) ---${NC}"
echo -e "${RED}================================================================${NC}"
echo -e "${YELLOW}警告：此腳本會將所有項目文件直接解壓到您當前的目錄中！${NC}"
echo -e "${YELLOW}為安全起見，強烈建議在一個新建的空文件夾中運行此命令。${NC}"
echo -e "${RED}================================================================${NC}"
sleep 5

# 1. 下載並解壓項目到當前目錄
echo -e "\n${YELLOW}[1/3] 正在下載並解壓項目文件...${NC}"
curl -L https://github.com/Limkon/Netwrok-file-manager/archive/refs/heads/master.tar.gz | tar -xz --strip-components=1 || { echo -e "${RED}錯誤：下載或解壓失敗。${NC}"; exit 1; }

# 2. 安裝依賴
echo -e "\n${YELLOW}[2/3] 正在安裝 Node.js 依賴...${NC}"
npm install || { echo -e "${RED}錯誤：'npm install' 失敗。${NC}"; exit 1; }

# 3. 修復安全漏洞
echo -e "\n${YELLOW}[3/3] 正在修復 Multer 安全漏洞...${NC}"
npm install multer@1.4.4-lts.1 > /dev/null 2>&1
npm audit fix --force > /dev/null 2>&1

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✅ 基礎安裝已成功完成！${NC}"
echo -e "${YELLOW}下一步需要您手動完成配置:${NC}"
echo "  1. 請在當前目錄下創建一個名為 '.env' 的文件。"
echo "  2. 在文件中填入所有必要的配置，例如："
echo "     BOT_TOKEN=your_token"
echo "     CHANNEL_ID=your_channel_id"
echo "     ADMIN_USER=admin"
echo "     ADMIN_PASS=your_password"
echo "     SESSION_SECRET=your_strong_random_secret"
echo "  3. 配置完成後，請直接啟動應用:"
echo "     ${GREEN}npm start${NC}"
echo -e "${GREEN}================================================================${NC}"
