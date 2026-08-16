// 全域狀態：儲存官方唯讀總表
let officialData = [];

// 全域狀態：儲存跨區所有資料
let allRegionsData = [];
let isAllRegionsMode = false; // 紀錄目前是否為「跨區顯示」模式
let crossRegionSortMode = 'date'; // 跨區排序模式：'date' 或 'location'
// ====== 新增：紀錄日期頁面的檢視模式 ======
let dateViewMode = 'split'; // 新增：紀錄日期頁面的檢視模式 ('split' 雙欄 或 'grid' 全部)

// 紀錄目前是否為編輯模式
let isEditMode = false;

// 新增：GAS API 網址 (請替換為你在階段一取得的網址)
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwhl53MHRxavzgmPTH0Y7Hbc7DCF5BhilpbqtocetOlFUVelND6HS6L25Viu3ezNNOF/exec";

// 新增：用來儲存從 API 抓回來的「完賽/延賽」狀態
let scheduleStatus = {};

// 新增：向 GAS API 獲取狀態資料
// ====== 【關鍵字：階段二 - 自動比對當前地區狀態】 ======
async function fetchScheduleStatus() {
    try {
        const response = await fetch(GAS_API_URL);
        const result = await response.json();

        if (result.success) {
            // 判斷當前網頁是哪一個地區
            let currentRegion = "未知";
            if (typeof DATA_URL !== 'undefined') {
                if (DATA_URL.includes('xinzhuang')) currentRegion = '新莊';
                else if (DATA_URL.includes('sanchong')) currentRegion = '三重';
                else if (DATA_URL.includes('shulin')) currentRegion = '樹林';
                else if (DATA_URL.includes('wugu')) currentRegion = '五股';
            }

            // 只提取屬於當前地區的日期狀態
            scheduleStatus = result.data[currentRegion] || {};
            console.log(`✅ 成功讀取【${currentRegion}】賽程狀態:`, scheduleStatus);
        }
    } catch (error) {
        console.error("❌ 讀取賽程狀態失敗:", error);
    }
}

// 切換編輯模式的函數
function toggleEditMode() {
    isEditMode = !isEditMode;
    const editBtn = document.getElementById('btn-toggle-edit');

    if (isEditMode) {
        editBtn.textContent = '完成編輯';
        editBtn.classList.add('active'); // 亮起藍色
        // 將所有可編輯欄位解鎖
        document.querySelectorAll('.editable-cell').forEach(cell => {
            cell.setAttribute('contenteditable', 'true');
            cell.style.backgroundColor = '#fdf8e3'; // 給一點微微的黃色底色提示可編輯
        });
    } else {
        editBtn.textContent = '編輯';
        editBtn.classList.remove('active'); // 恢復原本顏色
        // 將所有可編輯欄位上鎖
        document.querySelectorAll('.editable-cell').forEach(cell => {
            cell.setAttribute('contenteditable', 'false');
            cell.style.backgroundColor = ''; // 恢復原本顏色
        });
    }
}

// ================= 新增：歷史紀錄系統 =================
let viewHistory = [];
let isBacking = false;

function saveState(action, param) {
    if (isBacking) {
        isBacking = false; // 消耗掉標記，不重複紀錄
        return;
    }
    // 避免重複推入相同的狀態
    const last = viewHistory[viewHistory.length - 1];
    if (last && last.action === action && last.param === param) return;

    viewHistory.push({ action, param });
}
// ===================================================

// ====== 【關鍵字：階段二 - 初始化呼叫 API】 ======
async function initSystem() {
    try {
        // 同時發送請求：取得 JSON 賽程資料與 GAS API 狀態
        const targetJSON = typeof DATA_URL !== 'undefined' ? DATA_URL : 'sanchong_schedule.json';

        // 👇 修改這裡：把 fetchLastUpdateDate() 也加進 Promise.all 中同時等候 👇
        const [jsonResponse] = await Promise.all([
            fetch(targetJSON),
            fetchScheduleStatus(),
            fetchLastUpdateDate() // 新增這行：同步抓取 GitHub 更新日期
        ]);
        // 👆 修改結束 👆

        if (!jsonResponse.ok) throw new Error(`無法讀取 ${targetJSON}`);
        officialData = await jsonResponse.json();

        // ================= 新增：統一場地名稱格式 =================
        // 將 JSON 中原有的 "A場地"、"B場地" 自動轉換為 "該區A"、"該區B" (如：新莊A)
        let currentRegion = "未知";
        if (typeof DATA_URL !== 'undefined') {
            if (DATA_URL.includes('xinzhuang')) currentRegion = '新莊';
            else if (DATA_URL.includes('sanchong')) currentRegion = '三重';
            else if (DATA_URL.includes('shulin')) currentRegion = '樹林';
            else if (DATA_URL.includes('wugu')) currentRegion = '五股';
        }

        officialData.forEach(match => {
            if (match.location) {
                match.location = match.location.replace('A場地', `${currentRegion}A`)
                    .replace('B場地', `${currentRegion}B`)
                    .replace('C場地', `${currentRegion}C`);
            }
        });
        // ========================================================

        // ================= 新增：自動過濾重複的賽程 =================
        const uniqueMatches = new Map();
        officialData.forEach(match => {
            // 使用「日期 + 時間 + 場地」組合成唯一識別碼
            const uniqueKey = `${match.date}_${match.time}_${match.location}`;
            // 如果這個時間場地還沒被登記過，就把它存起來（重複的就會被自動忽略）
            if (!uniqueMatches.has(uniqueKey)) {
                uniqueMatches.set(uniqueKey, match);
            }
        });
        // 將過濾乾淨的資料重新覆蓋回去
        officialData = Array.from(uniqueMatches.values());
        // ========================================================

        // ================= 新增：強制將所有資料依「日期」與「時間」排序 =================
        officialData.sort((a, b) => {
            // 先比對日期 (由小到大)
            if (a.date !== b.date) {
                return a.date.localeCompare(b.date);
            }
            // 如果日期相同，再比對時間 (由早到晚)
            return (a.time || '').localeCompare(b.time || '');
        });
        // =========================================================================

        console.log(`✅ 成功載入 ${officialData.length} 筆賽事`);

        // 預設渲染：按日期檢視
        renderByDate();

        // 綁定頂部按鈕事件
        document.getElementById('btn-view-date').addEventListener('click', (e) => {
            setActiveButton(e.target);
            renderByDate();
        });

        // ================= 新增：綁定隊伍統計事件 =================
        document.getElementById('btn-view-stats').addEventListener('click', (e) => {
            setActiveButton(e.target);
            renderStats();
        });
        // ==========================================================

        // ================= 修改：綁定搜尋與下拉選單事件 =================
        const searchInput = document.getElementById('search-input');
        const searchDropdown = document.getElementById('search-dropdown');

        // 1. 提取所有不重複的隊伍名單 (排除雨備狀態)
        const teamsSet = new Set();
        officialData.forEach(m => {
            if (m.status !== 'rain_backup') {
                if (m.home_team) teamsSet.add(m.home_team);
                if (m.away_team) teamsSet.add(m.away_team);
            }
        });
        const allTeams = Array.from(teamsSet).sort();

        // 2. 監聽輸入框的打字事件 (即時比對關鍵字)
        searchInput.addEventListener('input', (e) => {
            const keyword = e.target.value.trim();
            searchDropdown.innerHTML = ''; // 清空選單

            if (!keyword) {
                searchDropdown.style.display = 'none';
                return;
            }

            // 過濾出包含關鍵字的隊伍名稱
            const matchedTeams = allTeams.filter(team => team.includes(keyword));

            if (matchedTeams.length > 0) {
                searchDropdown.style.display = 'block';
                matchedTeams.forEach(team => {
                    const li = document.createElement('li');
                    li.textContent = team;

                    // 當使用者點擊選單中的隊伍時
                    li.onmousedown = () => {
                        searchInput.value = team; // 將完整隊名填入輸入框
                        searchDropdown.style.display = 'none'; // 隱藏選單
                        renderSearchResult(team); // 直接用完整隊名進行搜尋並畫出表格
                    };
                    searchDropdown.appendChild(li);
                });
            } else {
                searchDropdown.style.display = 'none';
            }
        });

        // 3. 輸入框失去焦點時，自動隱藏下拉選單
        searchInput.addEventListener('blur', () => {
            searchDropdown.style.display = 'none';
        });

        // 4. 保留原本的「按鈕點擊」與「Enter 鍵」搜尋功能
        document.getElementById('btn-search').addEventListener('click', () => {
            const keyword = searchInput.value.trim();
            if (keyword) renderSearchResult(keyword);
            searchDropdown.style.display = 'none';
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const keyword = e.target.value.trim();
                if (keyword) renderSearchResult(keyword);
                searchDropdown.style.display = 'none';
            }
        });
        // ==============================================================

    } catch (error) {
        document.getElementById('schedule-container').innerHTML =
            `<div style="color:red; text-align:center; padding:20px; font-weight:bold;">資料載入失敗，請確認 ${typeof DATA_URL !== 'undefined' ? DATA_URL : 'schedule.json'} 是否存在。<br>錯誤訊息：${error.message}</div>`;
    }
}
// ====== 【新增：讀取 GitHub 儲存庫最後更新日期】 ======
async function fetchLastUpdateDate() {
    try {
        // 呼叫 GitHub API，取得 SealevelKID/softball 的最新一次 commit 紀錄
        const response = await fetch('https://api.github.com/repos/SealevelKID/softball/commits?per_page=1');
        const data = await response.json();

        if (data && data.length > 0) {
            // 解析 Commit 時間
            const commitDate = new Date(data[0].commit.committer.date);

            // 將時間格式化為 YYYY/MM/DD
            const year = commitDate.getFullYear();
            const month = String(commitDate.getMonth() + 1).padStart(2, '0');
            const day = String(commitDate.getDate()).padStart(2, '0');
            const dateStr = `${year}/${month}/${day}`;

            // 寫入畫面上的容器
            const updateContainer = document.getElementById('update-date-container');
            if (updateContainer) {
                updateContainer.textContent = `更新日期：${dateStr}`;
            }
        }
    } catch (error) {
        console.error("❌ 無法取得 GitHub 更新時間", error);
        const updateContainer = document.getElementById('update-date-container');
        if (updateContainer) {
            updateContainer.textContent = `更新日期：未知`;
        }
    }
}
// ==========================================================
// 切換按鈕的 Active 樣式 (並控制切換開關顯示)
function setActiveButton(clickedBtn) {
    document.querySelectorAll('.sys-btn').forEach(btn => btn.classList.remove('active'));
    if (clickedBtn) {
        clickedBtn.classList.add('active');

        // 控制日期 ON/OFF 開關的顯示與隱藏
        const viewSwitch = document.getElementById('date-view-switch');
        if (viewSwitch) {
            if (clickedBtn.id === 'btn-view-date') {
                viewSwitch.style.display = 'inline-flex'; // 在日期頁面時顯示
            } else {
                viewSwitch.style.display = 'none'; // 點擊其他頁面時隱藏
            }
        }
    }
}

// 檢視模式 1：按日期檢視 (支援 雙欄 / 全部 切換)
function renderByDate() {
    saveState('dateMenu', null);
    document.getElementById('captureArea').style.display = 'none';
    document.getElementById('btn-download').style.display = 'none';

    const container = document.getElementById('schedule-container');
    container.innerHTML = '';

    const filterContainer = document.getElementById('filter-container');
    filterContainer.style.display = 'block';
    filterContainer.innerHTML = '';

    const dates = [...new Set(officialData.map(match => match.date))].sort();

    // ==========================================
    // 共用邏輯：建立單一日期按鈕 (保留完整年份)
    // ==========================================
    const createDateBtn = (dateStr) => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.style.boxSizing = 'border-box';
        btn.style.width = '100%';
        btn.style.padding = '8px 5px';
        btn.style.fontSize = '0.95rem';
        btn.style.lineHeight = '1.2';

        const status = scheduleStatus[dateStr];

        if (status === '完賽') {
            btn.innerHTML = `${dateStr} <span style="font-size: 0.85em; font-weight: normal;">(完)</span>`;
            btn.style.backgroundColor = '#ecf0f1';
            btn.style.color = '#7f8c8d';
            btn.style.borderColor = '#bdc3c7';
        } else if (status === '延賽') {
            btn.innerHTML = `${dateStr} <span style="font-size: 0.85em; font-weight: normal;">(延)</span>`;
            btn.style.backgroundColor = '#fde8e8';
            btn.style.color = '#e74c3c';
            btn.style.borderColor = '#e74c3c';
        } else if (status === '雨備') {
            btn.innerHTML = `${dateStr} <span style="font-size: 0.85em; font-weight: normal;">(備)</span>`;
            btn.style.backgroundColor = '#e3f2fd'; // 淺藍色背景
            btn.style.color = '#2980b9';           // 深藍色文字
            btn.style.borderColor = '#3498db';     // 藍色邊框
        } else {
            btn.textContent = dateStr;
        }

        btn.onclick = () => {
            document.querySelectorAll('#filter-container .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (status === '完賽' || status === '延賽') {
                showStatusPopup(dateStr, status);
            } else {
                drawDateTable(dateStr);
            }
        };
        return btn;
    };

    // ==========================================
    // 依據當前模式進行渲染
    // ==========================================
    if (dateViewMode === 'grid') {
        // --- 模式：全部顯示 (一行三個) ---
        filterContainer.style.display = 'grid';
        filterContainer.style.gridTemplateColumns = 'repeat(3, 1fr)';
        filterContainer.style.gap = '8px';

        dates.forEach(date => {
            filterContainer.appendChild(createDateBtn(date));
        });

    } else {
        // --- 模式：雙欄分割 (左月份、右日期) ---
        const groupedDates = {};
        dates.forEach(date => {
            const monthKey = date.substring(0, 7);
            if (!groupedDates[monthKey]) groupedDates[monthKey] = [];
            groupedDates[monthKey].push(date);
        });

        const splitView = document.createElement('div');
        splitView.className = 'split-view-container';

        const leftMenu = document.createElement('div');
        leftMenu.className = 'split-left-menu';

        const rightContent = document.createElement('div');
        rightContent.className = 'split-right-content';

        splitView.appendChild(leftMenu);
        splitView.appendChild(rightContent);
        filterContainer.appendChild(splitView);

        let isFirstMonth = true;

        Object.keys(groupedDates).sort().forEach(monthKey => {
            const monthDates = groupedDates[monthKey];
            const [year, month] = monthKey.split('-');
            const displayMonth = parseInt(month, 10);

            const monthBtn = document.createElement('button');
            monthBtn.className = 'filter-btn';
            monthBtn.style.padding = '8px 5px';
            monthBtn.style.fontSize = '0.95rem';
            monthBtn.style.lineHeight = '1.2';
            monthBtn.innerHTML = `${displayMonth}月 <span style="font-size:0.85rem; font-weight:normal;">(${monthDates.length}場)</span>`;

            monthBtn.onclick = () => {
                leftMenu.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                monthBtn.classList.add('active');

                document.getElementById('captureArea').style.display = 'none';
                document.getElementById('btn-download').style.display = 'none';
                container.innerHTML = '';

                rightContent.innerHTML = '';
                monthDates.forEach(date => {
                    rightContent.appendChild(createDateBtn(date));
                });
            };

            leftMenu.appendChild(monthBtn);

            if (isFirstMonth) {
                monthBtn.click();
                isFirstMonth = false;
            }
        });
    }
} // renderByDate 結束

// ====== 【關鍵字：階段二 - 變色按鈕與彈出卡片】下方的 showStatusPopup ======
function showStatusPopup(date, status) {
    // 隱藏表格區域
    document.getElementById('captureArea').style.display = 'none';
    document.getElementById('btn-download').style.display = 'none';
    const container = document.getElementById('schedule-container');

    // 【修改這裡】精準對應各區的 Google 搜尋網址與免責聲明的名稱
    let currentRegion = document.title;
    let searchLink = "#";
    let searchName = "該區慢壘會";

    if (currentRegion.includes('三重')) {
        searchLink = "https://www.google.com/search?q=%E4%B8%89%E9%87%8D%E6%85%A2%E5%A3%98%E6%9C%83";
        searchName = "三重慢壘會";
    } else if (currentRegion.includes('新莊')) {
        searchLink = "https://www.google.com/search?q=%E6%96%B0%E5%8C%97%E5%B8%82%E6%96%B0%E8%8E%8A%E6%85%A2%E5%A3%98%E5%8D%94%E6%9C%83";
        searchName = "新北市新莊慢壘協會";
    } else if (currentRegion.includes('五股')) {
        searchLink = "https://www.google.com/search?q=%E6%96%B0%E5%8C%97%E5%B8%82%E4%BA%94%E8%82%A1%E6%85%A2%E5%A3%98";
        searchName = "新北市五股慢壘";
    } else if (currentRegion.includes('樹林')) {
        searchLink = "https://www.google.com/search?q=%E6%A8%B9%E6%9E%97%E6%85%A2%E5%A3%98%E6%9C%83";
        searchName = "樹林慢壘會";
    }

    let icon = status === '完賽' ? '🏆' : '🌧️';
    let color = status === '完賽' ? '#27ae60' : '#e67e22';
    let message = status === '完賽'
        ? `本賽事已順利完賽！<br>詳細成績與晉級結果請至官方公告查詢。`
        : `本賽事因故延期。<br>後續補賽時間請密切注意官方公告。`;

    // 繪製彈出卡片 UI
    container.innerHTML = `
        <div style="padding: 20px; background: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); width: 100%; box-sizing: border-box; text-align: center; border-top: 5px solid ${color}; margin-top: 20px;">
            <div style="font-size: 3rem; margin-bottom: 15px;">${icon}</div>
            <h3 style="margin-top: 0; color: ${color}; font-size: 1.5rem; margin-bottom: 10px;">${date} 賽事已${status}</h3>
            <p style="font-size: 1.1rem; color: #34495e; line-height: 1.6; margin-bottom: 20px;">
                ${message}
            </p>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                <a href="${searchLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 10px 20px; background-color: #3498db; color: white; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 1rem; box-shadow: 0 4px 6px rgba(52, 152, 219, 0.3);">
                    🔍 前往 ${searchName}
                </a>
                <button id="btn-view-original" onclick="showOriginalTable('${date}')" class="sys-btn" style="padding: 10px 20px; font-size: 1rem;">
                    📋 查看原賽程
                </button>
            </div>
        </div>
    `;
}
// ================= 新增：在通知卡片下方展開原賽程 =================
function showOriginalTable(date) {
    // 1. 呼叫原有功能畫出表格
    drawDateTable(date);

    // 2. 利用 DOM 操作，將表格區塊 (captureArea) 動態移動到通知卡片 (schedule-container) 的「正下方」
    const captureArea = document.getElementById('captureArea');
    const scheduleContainer = document.getElementById('schedule-container');
    scheduleContainer.parentNode.insertBefore(captureArea, scheduleContainer.nextSibling);

    // 【修改這裡】新增上方外邊距，將表格與上方的卡片推開，避免視覺沾黏
    captureArea.style.marginTop = '20px';

    // 3. 隱藏這顆「仍要查看原賽程」按鈕，讓畫面保持乾淨
    const btn = document.getElementById('btn-view-original');
    if (btn) btn.style.display = 'none';

    // 4. 畫面自動稍微往下滑，引導使用者看見下方出現的表格
    captureArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ================= 處理隊伍名稱分行與自動縮小 (優化中英文權重與括號不換行) =================
function formatTeamName(teamStr, isEnlarged = false) {
    if (!teamStr || teamStr === "未知") return teamStr || "";

    let cleanStr = teamStr.replace(/\r?\n/g, '').trim();
    const match = cleanStr.match(/^([A-Z]\d{1,2})(.*)/);

    let code = "";
    let name = cleanStr;
    if (match) {
        code = match[1];
        name = match[2];
    }

    let calcLength = 0;
    for (let i = 0; i < name.length; i++) {
        if (/[a-zA-Z0-9\/\(\)]/.test(name[i])) {
            calcLength += 0.5;
        } else {
            calcLength += 1;
        }
    }

    let nameStyle = "display: block; white-space: normal; word-break: break-word; margin-top: 2px; line-height: 1.2;";

    if (isEnlarged) {
        if (calcLength >= 6) {
            nameStyle += " font-size: 0.95rem; font-weight: bold; letter-spacing: -0.5px;";
        } else if (calcLength >= 4) {
            nameStyle += " font-size: 1.1rem; font-weight: bold;";
        } else {
            nameStyle += " font-size: 1.2rem; font-weight: bold;";
        }
    } else {
        if (calcLength >= 6) {
            nameStyle += " font-size: 0.75rem; letter-spacing: -0.5px;";
        } else if (calcLength >= 4) {
            nameStyle += " font-size: 0.85rem;";
        } else {
            nameStyle += " font-size: 1rem;";
        }
    }

    // 【新增】：使用正則表達式，把帶有括號的字串（例如 1/4(勝) 或 (敗)）包起來，強制其不換行
    let displayName = name.replace(/([a-zA-Z0-9\/]*[（\(][^）\)]+[）\)])/g, '<span style="white-space: nowrap;">$1</span>');

    if (code) {
        let codeSize = isEnlarged ? "0.95rem" : "0.85rem";
        return `<div style="text-align: center; line-height: 1.1;">
                    <span style="display: block; font-size: ${codeSize}; color: #7f8c8d; font-weight: normal;">${code}</span>
                    <span style="${nameStyle}">${displayName}</span>
                </div>`;
    } else {
        return `<div style="text-align: center; ${nameStyle}">${displayName}</div>`;
    }
}

// ================= 新增：共用表格按鈕設定 (含五股專屬滑動邏輯) =================
function setupTableButtons() {
    const captureArea = document.getElementById('captureArea');
    const btnDownload = document.getElementById('btn-download');

    btnDownload.style.display = 'inline-block';
    btnDownload.style.position = 'absolute';
    btnDownload.style.top = '55px'; // 向下移避開主標題
    btnDownload.style.right = '15px';
    btnDownload.style.left = 'auto';
    btnDownload.style.zIndex = '10';
    // 淡化下載按鈕
    btnDownload.style.opacity = '0.8';
    btnDownload.style.backgroundColor = '#f8f9fa';
    btnDownload.style.color = '#7f8c8d';
    btnDownload.style.border = '1px solid #bdc3c7';

    let btnEdit = document.getElementById('btn-toggle-edit');
    if (!btnEdit) {
        btnEdit = document.createElement('button');
        btnEdit.id = 'btn-toggle-edit';
        btnEdit.className = 'sys-btn';
        btnEdit.setAttribute('data-html2canvas-ignore', 'true');
        btnEdit.onclick = toggleEditMode;
        captureArea.appendChild(btnEdit);
    }

    btnEdit.style.display = 'inline-block';
    btnEdit.textContent = '編輯';
    btnEdit.classList.remove('active');
    btnEdit.style.position = 'absolute';
    btnEdit.style.top = '55px'; // 向下移避開主標題
    btnEdit.style.left = '15px';
    btnEdit.style.right = 'auto';
    btnEdit.style.zIndex = '10';
    // 淡化編輯按鈕
    btnEdit.style.opacity = '0.8';
    btnEdit.style.backgroundColor = '#f8f9fa';
    btnEdit.style.color = '#7f8c8d';
    btnEdit.style.border = '1px solid #bdc3c7';

    // 【修改】判斷是否為五股區
    const isWugu = document.title.includes('五股');

    if (isWugu && !captureArea._scrollSyncBound) {
        const syncButtons = () => {
            const sl = captureArea.scrollLeft;
            if (btnEdit) btnEdit.style.transform = `translateX(${sl}px)`;
            if (btnDownload) btnDownload.style.transform = `translateX(${sl}px)`;
        };
        captureArea.addEventListener('scroll', syncButtons);
        window.addEventListener('resize', syncButtons);
        new ResizeObserver(syncButtons).observe(captureArea);
        captureArea._scrollSyncBound = true;
    } else if (!isWugu) {
        // 非五股區，強制清除可能的位移殘留，釘死在左上與右上
        if (btnEdit) btnEdit.style.transform = 'none';
        if (btnDownload) btnDownload.style.transform = 'none';
    }
}

// 核心功能 A：繪製「特定日期」的表格 (時間 | 場地A | 場地B ...)
function drawDateTable(selectedDate) {
    saveState('dateTable', selectedDate);
    const captureArea = document.getElementById('captureArea');
    const scheduleHead = document.getElementById('scheduleHead');
    const scheduleBody = document.getElementById('scheduleBody');
    const title = document.getElementById('captureTitle');

    // 【關鍵修正】切換日期畫新表格時，強制清空原本可能殘留的延賽/完賽卡片
    document.getElementById('schedule-container').innerHTML = '';

    // 每次重新畫表格時，預設重置為「非編輯模式」
    isEditMode = false;

    captureArea.style.display = 'block';
    
    // ================= 新增：計算左右切換箭頭 =================
    const allDates = [...new Set(officialData.map(m => m.date))].sort();
    const currentIndex = allDates.indexOf(selectedDate);
    
    let leftArrow = '';
    let rightArrow = '';
    
    // 如果不是第一天，顯示左箭頭
    if (currentIndex > 0) {
        const prevDate = allDates[currentIndex - 1];
        // 【修改】縮小 padding 與 margin 讓箭頭靠中間，並加入 data-html2canvas-ignore="true" 讓截圖時自動消失
        leftArrow = `<span data-html2canvas-ignore="true" style="cursor: pointer; padding: 0 5px; margin: 0 8px; color: #3498db; user-select: none; font-weight: bold;" onclick="drawDateTable('${prevDate}')">〈</span>`;
    }
    // 如果不是最後一天，顯示右箭頭
    if (currentIndex < allDates.length - 1) {
        const nextDate = allDates[currentIndex + 1];
        // 【修改】同上
        rightArrow = `<span data-html2canvas-ignore="true" style="cursor: pointer; padding: 0 5px; margin: 0 8px; color: #3498db; user-select: none; font-weight: bold;" onclick="drawDateTable('${nextDate}')">〉</span>`;
    }
    
    // 將箭頭與標題組合 (改用 innerHTML 渲染)
    title.innerHTML = `${leftArrow} <span style="display:inline-block;">${selectedDate} 賽程</span> ${rightArrow}`;
    // ==========================================================

    // 💡 1. 先將資料過濾提上來，算出這天總共有「幾個場地」
    const matches = officialData.filter(m => m.date === selectedDate);
    const locations = [...new Set(matches.map(m => m.location))].sort();

    // 過濾出正常比賽的時間
    const normalMatches = matches.filter(m => m.status !== 'rain_backup');
    let times = [...new Set(normalMatches.map(m => m.time))].sort();

    // 【新增邏輯】為了讓「雨備日」能夠往下跨滿整個下午，我們需要確保時間軸(times)包含完整的下午時段
    const hasRainBackup = matches.some(m => m.status === 'rain_backup');
    if (hasRainBackup) {
        if (times.length > 0) {
            // 自動判斷當天的時間間隔（包含 55, 50, 45 分的通常是 55 分鐘制）
            const is55Min = times.some(t => t.endsWith(':55') || t.endsWith(':50') || t.endsWith(':45'));
            const fullTimes = is55Min
                ? ["08:00", "08:55", "09:50", "10:45", "11:40", "12:35", "13:30", "14:25", "15:20"]
                : ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
            // 聯集合併並重新排序，確保時間軸補滿到下午
            times = [...new Set([...times, ...fullTimes])].sort();
        } else {
            // 如果整天一場正常比賽都沒有，預設展開整點時間表來撐開大格子
            times = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
        }
    } else if (times.length === 0) {
        times = ["全天"];
    }

    const cachedEdits = getCache();

    // 💡 2. 動態判斷寬度：3個場地以上才撐開，否則100%貼合螢幕(消除滑桿)
    const hasManyLocations = locations.length >= 3;
    if (hasManyLocations) {
        document.getElementById('scheduleTable').style.minWidth = '650px';
    } else {
        document.getElementById('scheduleTable').style.minWidth = '100%';
    }

    // ================= 按鈕位置自動跟隨固定邏輯 =================
    const btnDownload = document.getElementById('btn-download');
    btnDownload.style.display = 'inline-block';
    btnDownload.style.position = 'absolute';
    btnDownload.style.top = '55px'; // 向下移避開主標題
    btnDownload.style.right = '15px'; // 基準點釘在右側
    btnDownload.style.left = 'auto';
    btnDownload.style.zIndex = '10';
    // 確保下載按鈕保持淡化
    btnDownload.style.opacity = '0.8';
    btnDownload.style.backgroundColor = '#f8f9fa';
    btnDownload.style.color = '#7f8c8d';
    btnDownload.style.border = '1px solid #bdc3c7';

    let btnEdit = document.getElementById('btn-toggle-edit');
    if (!btnEdit) {
        btnEdit = document.createElement('button');
        btnEdit.id = 'btn-toggle-edit';
        btnEdit.className = 'sys-btn';
        btnEdit.setAttribute('data-html2canvas-ignore', 'true');
        btnEdit.onclick = toggleEditMode;
        captureArea.appendChild(btnEdit);
    }

    // 初始化編輯按鈕狀態
    btnEdit.style.display = 'inline-block';
    btnEdit.textContent = '編輯';
    btnEdit.classList.remove('active');
    btnEdit.style.position = 'absolute';
    btnEdit.style.top = '55px'; // 向下移避開主標題
    btnEdit.style.left = '15px'; // 基準點釘在左側
    btnEdit.style.right = 'auto';
    btnEdit.style.zIndex = '10';
    // 確保編輯按鈕保持淡化
    btnEdit.style.opacity = '0.8';
    btnEdit.style.backgroundColor = '#f8f9fa';
    btnEdit.style.color = '#7f8c8d';
    btnEdit.style.border = '1px solid #bdc3c7';

    // 💡 3. 只有「場地多導致有捲軸」時，才啟動滑動抵銷邏輯
    if (hasManyLocations) {
        if (!captureArea._scrollSyncBound) {
            const syncButtons = () => {
                const sl = captureArea.scrollLeft;
                if (btnEdit) btnEdit.style.transform = `translateX(${sl}px)`;
                if (btnDownload) btnDownload.style.transform = `translateX(${sl}px)`;
            };
            captureArea.addEventListener('scroll', syncButtons);
            window.addEventListener('resize', syncButtons);
            new ResizeObserver(syncButtons).observe(captureArea);
            captureArea._scrollSyncBound = true;
        }
    } else {
        // 沒有滑動需求時，強制清除可能殘留的位移，讓按鈕乖乖待在左右上角
        if (btnEdit) btnEdit.style.transform = 'none';
        if (btnDownload) btnDownload.style.transform = 'none';
    }
    // ==============================================================

    // 👇---------- 從這裡開始替換表頭與表身邏輯 ----------👇

    // 【修改】時間欄位的右邊也要加粗一條線，與場地切開 (改為 2px 與外框一致)
    let headHTML = `<th style="border-right: 2px solid #2c3e50;">時間</th>`;
    locations.forEach((loc, index) => {
        // 判斷是否為最後一個場地，若不是，右邊就加上粗黑線 (改為 2px)
        const borderStyle = (index < locations.length - 1) ? 'border-right: 2px solid #2c3e50;' : '';
        headHTML += `<th colspan="2" style="${borderStyle}">${loc}</th>`;
    });
    scheduleHead.innerHTML = headHTML;

    scheduleBody.innerHTML = '';

    // 【新增】紀錄某個場地是否已經畫過「向下跨列」的雨備日，若畫過則後續時段自動跳過
    const rainBackupRendered = {};

    times.forEach((time, timeIndex) => {
        let rowHTML = `<td style="border-right: 2px solid #2c3e50;">${time}</td>`;

        locations.forEach((loc, index) => {
            const borderStyle = (index < locations.length - 1) ? 'border-right: 2px solid #2c3e50;' : '';

            // 如果該場地已經被上面的雨備日跨列覆蓋了，這一格直接跳過不畫
            if (rainBackupRendered[loc]) return;

            // 尋找這個時段是否有「非雨備」的正常比賽
            const match = matches.find(m => m.time === time && m.location === loc && m.status !== 'rain_backup');

            if (match) {
                const matchId = `${match.date}_${match.time}_${match.location}`;
                const cachedMatch = cachedEdits[matchId] || {};

                if (!match.home_team && !match.away_team) {
                    const displayNote = cachedMatch.note !== undefined ? cachedMatch.note : (match.note || '');
                    rowHTML += `<td colspan="2" class="editable-cell" contenteditable="false" style="outline: none; transition: background-color 0.2s; ${borderStyle}" onblur="saveEdit('${matchId}', 'note', this.innerText)" title="點擊編輯按鈕後可修改">${displayNote}</td>`;
                } else {
                    const displayHome = cachedMatch.home_team !== undefined ? cachedMatch.home_team : (match.home_team || '');
                    const displayAway = cachedMatch.away_team !== undefined ? cachedMatch.away_team : (match.away_team || '');

                    const homeHTML = formatTeamName(displayHome);
                    const awayHTML = formatTeamName(displayAway);
                    
                    // 先取得備註內容，用來判斷是否要啟動防護罩(安全距離)
                    const mNote = cachedMatch.note !== undefined ? cachedMatch.note : (match.note || '');

                    const isAwayFirst = document.title.includes('樹林') || document.title.includes('五股');
                    
                    // 【修改】動態設定內距。如果有備註，左邊格子右側留 24px，右邊格子左側留 24px 避免文字重疊
                    const leftPadding = mNote ? "5px 24px 5px 5px" : "5px";
                    const rightPadding = mNote ? "5px 5px 5px 24px" : "5px";

                    const leftTeamStyle = `outline: none; vertical-align: middle; padding: ${leftPadding}; transition: background-color 0.2s; position: relative;`;
                    const rightTeamStyle = `outline: none; vertical-align: middle; padding: ${rightPadding}; transition: background-color 0.2s; ${borderStyle}`;

                    let leftHTML = isAwayFirst ? awayHTML : homeHTML;
                    let rightHTML = isAwayFirst ? homeHTML : awayHTML;
                    let leftField = isAwayFirst ? 'away_team' : 'home_team';
                    let rightField = isAwayFirst ? 'home_team' : 'away_team';

                    // 【修改】字體縮小為 0.75rem，並加入 pointer-events: none 確保滑鼠點擊不會被這塊小標籤擋住
                    const noteBadge = mNote ? `<div contenteditable="false" style="position: absolute; right: 0; top: 50%; transform: translate(50%, -50%); color: #c0392b; font-size: 0.75rem; font-weight: bold; background: white; padding: 1px 2px; border-radius: 4px; z-index: 5; white-space: nowrap; box-shadow: 0 0 3px rgba(0,0,0,0.1); pointer-events: none;">${mNote}</div>` : '';

                    const tdLeft = `<td class="editable-cell" contenteditable="false" style="${leftTeamStyle}" onblur="saveEdit('${matchId}', '${leftField}', this.innerText.replace(/\\r?\\n/g, ''))" title="點擊編輯按鈕後可修改">${leftHTML}${noteBadge}</td>`;
                    const tdRight = `<td class="editable-cell" contenteditable="false" style="${rightTeamStyle}" onblur="saveEdit('${matchId}', '${rightField}', this.innerText.replace(/\\r?\\n/g, ''))" title="點擊編輯按鈕後可修改">${rightHTML}</td>`;

                    rowHTML += tdLeft + tdRight;
                }
            } else {
                // 這個時段沒有正常賽程。檢查該場地今天是否有「雨備日」註記
                const rainMatch = matches.find(m => m.location === loc && m.status === 'rain_backup');
                if (rainMatch) {
                    // 計算要往下跨越多大：從當前時段一路跨到最後一列
                    let rowspanCount = 0;
                    for (let i = timeIndex; i < times.length; i++) {
                        const futureMatch = matches.find(m => m.time === times[i] && m.location === loc && m.status !== 'rain_backup');
                        if (futureMatch) break;
                        rowspanCount++;
                    }

                    const matchId = `${rainMatch.date}_${rainMatch.time}_${rainMatch.location}`;
                    const cachedMatch = cachedEdits[matchId] || {};
                    const displayNote = cachedMatch.note !== undefined ? cachedMatch.note : (rainMatch.note || '雨備日');

                    // 輸出跨列的「雨備日」儲存格 (保留紅色大字體，無背景色)
                    rowHTML += `<td colspan="2" rowspan="${rowspanCount}" class="editable-cell" contenteditable="false" style="color: #c0392b; font-size: 1.5rem; font-weight: bold; letter-spacing: 5px; vertical-align: middle; text-align: center; outline: none; transition: background-color 0.2s; ${borderStyle}" onblur="saveEdit('${matchId}', 'note', this.innerText)" title="點擊編輯按鈕後可修改">${displayNote}</td>`;

                    // 標記該場地已經產生雨備
                    rainBackupRendered[loc] = true;
                } else {
                    // 只是單純沒比賽的空堂
                    rowHTML += `<td></td><td style="${borderStyle}"></td>`;
                }
            }
        });
        scheduleBody.innerHTML += `<tr>${rowHTML}</tr>`;
    });

    // ================= 新增：表格下方的每日備註欄位 =================
    let noteContainer = document.getElementById('daily-note-container');
    if (!noteContainer) {
        // 如果還沒有這個區塊，就動態建立一個，並安插在表格的下方
        noteContainer = document.createElement('div');
        noteContainer.id = 'daily-note-container';
        const table = document.getElementById('scheduleTable');
        table.parentNode.insertBefore(noteContainer, table.nextSibling);
    }
    
    // 定義這天備註專屬的暫存 ID (例如: 2026-08-23_daily)
    const dailyNoteId = `${selectedDate}_daily`;
    const cachedDailyNote = cachedEdits[dailyNoteId] || {};
    
    // ================= 新增：讀取 JSON 中的每日總備註 (daily_note) =================
    // 系統直接抓取該日期「第一場比賽」的 daily_note 欄位
    const displayDailyNote = cachedDailyNote.daily_note !== undefined ? cachedDailyNote.daily_note : (matches[0].daily_note || "");
    // ====================================================================

    // 渲染紅色粗體備註文字，並套用 Flexbox 讓備註與更新日期並排！
    noteContainer.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8px; padding: 0 5px;">
            <div style="flex: 1; text-align: left;">
                <span style="color: red; font-weight: bold; font-size: 1.2rem;">備註：</span>
                <span class="editable-cell" contenteditable="false" style="color: red; font-weight: bold; font-size: 1.2rem; outline: none; transition: background-color 0.2s; min-width: 50px; display: inline-block; cursor: text;" onblur="saveEdit('${dailyNoteId}', 'daily_note', this.innerText)" title="點擊編輯按鈕後可修改">${displayDailyNote}</span>
            </div>
            <div id="dynamic-update-date" style="color: #bdc3c7; font-size: 0.85rem; white-space: nowrap; margin-left: 10px;">
                讀取中...
            </div>
        </div>
    `;

    // 抓取原本 HTML 中的更新日期文字，並塞入我們新建立的右側區塊
    const originalUpdateContainer = document.getElementById('update-date-container');
    const dynamicUpdateDate = document.getElementById('dynamic-update-date');
    if (originalUpdateContainer && dynamicUpdateDate) {
        dynamicUpdateDate.textContent = originalUpdateContainer.textContent;
        // 隱藏原本會佔據換行空間的舊區塊
        originalUpdateContainer.style.display = 'none'; 
    }
    // ==============================================================

    // 👆---------- 替換到這裡結束 ----------👆
}

// 共用元件：產生單一賽程卡片 DOM
function createMatchCard(match, headerType) {
    const card = document.createElement('div');
    card.className = 'card';

    // 根據目前的檢視模式，決定右上角要顯示場地還是日期
    const topRightInfo = headerType === 'location'
        ? `<span class="clickable-tag" onclick="alert('場地：${match.location}')">📍 ${match.location}</span>`
        : `<span class="clickable-tag" onclick="alert('日期：${match.date}')">📅 ${match.date}</span>`;

    // 【自動判斷】根據地區決定誰在左邊、誰在右邊
    const isAwayFirst = document.title.includes('樹林') || document.title.includes('五股');
    const leftTeam = isAwayFirst ? match.away_team : match.home_team;
    const rightTeam = isAwayFirst ? match.home_team : match.away_team;

    if (match.status === 'rain_backup') {
        card.innerHTML = `
            <div class="card-header">
                <span>⏰ ${match.time}</span>
                ${topRightInfo}
            </div>
            <div class="card-body rain-backup">
                ⚠️ ${match.note}
            </div>
        `;
    } else {
        // 套用動態決定的左右順序
        card.innerHTML = `
            <div class="card-header">
                <span>⏰ ${match.time}</span>
                ${topRightInfo}
            </div>
            <div class="card-body">
                <span class="clickable-tag" onclick="triggerTeamSearch('${leftTeam}')">${leftTeam}</span> 
                vs 
                <span class="clickable-tag" onclick="triggerTeamSearch('${rightTeam}')">${rightTeam}</span>
            </div>
        `;
    }
    return card;
}

// 啟動應用程式
initSystem();

// 檢視模式 3：搜尋結果 (動態表頭與標題，支援跨區切換)
async function renderSearchResult(keyword, forceAllRegions = false, sortMode = 'date') {
    saveState('search', keyword);

    // 進入搜尋結果時強制隱藏日期切換開關 (更新為新版開關 ID)
    const viewSwitch = document.getElementById('date-view-switch');
    if (viewSwitch) viewSwitch.style.display = 'none';

    const container = document.getElementById('schedule-container');
    const captureArea = document.getElementById('captureArea');
    const scheduleHead = document.getElementById('scheduleHead');
    const scheduleBody = document.getElementById('scheduleBody');
    const title = document.getElementById('captureTitle');
    const filterContainer = document.getElementById('filter-container');
    const downloadBtn = document.getElementById('btn-download');

    // 更新全域狀態
    isAllRegionsMode = forceAllRegions;
    crossRegionSortMode = sortMode;

    // 清空畫面
    container.innerHTML = '';
    document.querySelectorAll('.sys-btn').forEach(btn => btn.classList.remove('active'));

    // ================= 新增：跨區切換按鈕 UI =================
    filterContainer.style.display = 'block'; // 改為 block 方便多行排版
    filterContainer.innerHTML = `
        <div style="display: flex; gap: 10px; width: 100%; margin-bottom: 10px;">
            <button class="filter-btn ${!isAllRegionsMode ? 'active' : ''}" style="flex: 1;" onclick="renderSearchResult('${keyword}', false)">📍 僅顯示本區</button>
            <button class="filter-btn ${isAllRegionsMode ? 'active' : ''}" style="flex: 1;" onclick="renderSearchResult('${keyword}', true, '${crossRegionSortMode}')">🌍 顯示所有地區</button>
        </div>
    `;

    // 若處於跨區模式，額外顯示次級排序選單
    if (isAllRegionsMode) {
        filterContainer.innerHTML += `
            <div style="display: flex; gap: 10px; width: 100%; align-items: center; border-top: 1px dashed #bdc3c7; padding-top: 10px; margin-top: 5px;">
                <span style="font-size: 1rem; color: #7f8c8d; white-space: nowrap; flex-shrink: 0;">排序方式：</span>
                <button class="filter-btn ${crossRegionSortMode === 'date' ? 'active' : ''}" style="flex: 1;" onclick="renderSearchResult('${keyword}', true, 'date')">📅 依日期</button>
                <button class="filter-btn ${crossRegionSortMode === 'location' ? 'active' : ''}" style="flex: 1;" onclick="renderSearchResult('${keyword}', true, 'location')">🏟️ 依場地</button>
            </div>
        `;
    }
    // =======================================================

    // 決定要搜尋的資料來源 (本區 or 全區)
    let sourceData = officialData;

    if (isAllRegionsMode) {
        // 如果還沒載入過全區資料，就發動 Fetch 拉取一次並快取起來
        if (allRegionsData.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:20px; color:#3498db; font-weight:bold;">🔄 正在載入各區賽程...</div>`;
            const files = ['sanchong_schedule.json', 'shulin_schedule.json', 'wugu_schedule.json', 'xinzhuang_schedule.json'];

            const rawAllData = [];
            for (const file of files) {
                try {
                    const res = await fetch(file);
                    if (res.ok) {
                        const data = await res.json();
                        const regionName = file.split('_')[0].replace('sanchong', '三重').replace('shulin', '樹林').replace('wugu', '五股').replace('xinzhuang', '新莊');
                        data.forEach(m => {
                            m.region = regionName;
                            // 【新增】跨區載入時，同步將所有區域的 A場地/B場地 替換為統一格式
                            if (m.location) {
                                m.location = m.location.replace('A場地', `${regionName}A`)
                                    .replace('B場地', `${regionName}B`)
                                    .replace('C場地', `${regionName}C`);
                            }
                        });
                        rawAllData.push(...data);
                    }
                } catch (e) {
                    console.error(`無法讀取 ${file}`, e);
                }
            }

            // 【新增】跨區資料也進行去重複處理
            const uniqueAllMatches = new Map();
            rawAllData.forEach(match => {
                const uniqueKey = `${match.date}_${match.time}_${match.location}`;
                if (!uniqueAllMatches.has(uniqueKey)) {
                    uniqueAllMatches.set(uniqueKey, match);
                }
            });
            allRegionsData = Array.from(uniqueAllMatches.values());

            container.innerHTML = '';
        }
        sourceData = allRegionsData;
    }

    // 開始過濾資料
    let results = sourceData.filter(match => {
        const cleanHome = match.home_team ? match.home_team.replace(/^[A-Z]\d{1,2}/, '') : '';
        const cleanAway = match.away_team ? match.away_team.replace(/^[A-Z]\d{1,2}/, '') : '';
        const noteMatch = match.note ? match.note.includes(keyword) : false;
        return (match.home_team === keyword) || (cleanHome === keyword) ||
            (match.away_team === keyword) || (cleanAway === keyword) || noteMatch;
    });

    // ================= 新增：全區資料排序邏輯 =================
    if (isAllRegionsMode) {
        results.sort((a, b) => {
            if (crossRegionSortMode === 'date') {
                if (a.date !== b.date) return a.date.localeCompare(b.date);
                if (a.time !== b.time) return (a.time || '').localeCompare(b.time || '');
                return (a.location || '').localeCompare(b.location || '');
            } else { // 依場地
                if (a.region !== b.region) return (a.region || '').localeCompare(b.region || ''); // 先比地區
                if (a.location !== b.location) return (a.location || '').localeCompare(b.location || ''); // 再比場地
                if (a.date !== b.date) return a.date.localeCompare(b.date);
                return (a.time || '').localeCompare(b.time || '');
            }
        });
    }
    // ==========================================================

    if (results.length === 0) {
        captureArea.style.display = 'none';
        downloadBtn.style.display = 'none';
        container.innerHTML = `<div style="text-align:center; padding:20px; color:#7f8c8d;">找不到與「${keyword}」相關的賽程。</div>`;
        return;
    }

    if (results.length === 0) {
        captureArea.style.display = 'none';
        downloadBtn.style.display = 'none';
        container.innerHTML = `<div style="text-align:center; padding:20px; color:#7f8c8d;">找不到與「${keyword}」相關的賽程。</div>`;
        return;
    }

    isEditMode = false; // 重置編輯模式
    captureArea.style.display = 'block';
    title.textContent = isAllRegionsMode ? `${keyword} 跨區總賽程` : `${keyword} 本區賽程`;
    document.getElementById('scheduleTable').style.minWidth = '100%';

    // ================= 新增：動態切換主標題 =================
    const mainTitle = document.querySelector('#captureArea h1');
    if (mainTitle) {
        if (isAllRegionsMode) {
            mainTitle.textContent = '115年新北市慢壘秋季聯賽賽程表';
        } else {
            // 利用 document.title 完美還原原本各地區的標題
            mainTitle.textContent = document.title;
        }
    }
    // =======================================================

    // 呼叫共用的按鈕設定邏輯
    setupTableButtons();

    // 取得暫存資料
    const cachedEdits = getCache();

    scheduleHead.innerHTML = `
        <th style="width: 22%;">日期</th>
        <th style="width: 16%;">地點</th>
        <th style="width: 16%;">時間</th>
        <th style="width: 46%;">對手</th>
    `;
    scheduleBody.innerHTML = '';

    let i = 0;
    while (i < results.length) {
        let currentMatch = results[i];
        let rowspanCount = 1;
        let j = i + 1;

        while (j < results.length &&
            results[j].date === currentMatch.date &&
            results[j].location === currentMatch.location &&
            results[j].region === currentMatch.region) {
            rowspanCount++;
            j++;
        }

        for (let k = 0; k < rowspanCount; k++) {
            const match = results[i + k];
            const tr = document.createElement('tr');

            const matchId = `${match.date}_${match.time}_${match.location}`;
            const cachedMatch = cachedEdits[matchId] || {};

            if (k === 0) {
                const dateObj = new Date(match.date);
                const formattedDate = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
                const locDisplay = (isAllRegionsMode && match.region) ? `<span style="color:#3498db;font-size:0.85rem;">[${match.region}]</span><br>${match.location}` : match.location;

                tr.innerHTML += `<td rowspan="${rowspanCount}" class="editable-cell" contenteditable="false" title="點擊編輯按鈕後可修改">${formattedDate}</td>`;
                tr.innerHTML += `<td rowspan="${rowspanCount}" class="editable-cell" contenteditable="false" title="點擊編輯按鈕後可修改" style="line-height: 1.2;">${locDisplay}</td>`;
            }

            let opponentStr = "";
            let opponentField = "";

            // 修改：搜尋結果中若遇到雨備或無主客隊的註記賽程，正常顯示於對手欄位
            if (match.status === 'rain_backup' || (!match.home_team && !match.away_team)) {
                opponentStr = cachedMatch.note !== undefined ? cachedMatch.note : (match.note || "");
                const textStyle = (match.status === 'rain_backup') ? "color: #c0392b; font-weight: bold; letter-spacing: 2px;" : "";

                tr.innerHTML += `<td class="editable-cell" contenteditable="false" title="點擊編輯按鈕後可修改">${match.time}</td>`;
                tr.innerHTML += `<td class="editable-cell" contenteditable="false" style="outline:none; transition: background-color 0.2s; ${textStyle}" onblur="saveEdit('${matchId}', 'note', this.innerText)" title="點擊編輯按鈕後可修改">${opponentStr}</td>`;
            } else {
                const displayHome = cachedMatch.home_team !== undefined ? cachedMatch.home_team : match.home_team;
                const displayAway = cachedMatch.away_team !== undefined ? cachedMatch.away_team : match.away_team;

                let cleanHomeForOpponent = displayHome ? displayHome.replace(/^[A-Z]\d{1,2}/, '') : '';
                let isHome = (displayHome === keyword || cleanHomeForOpponent === keyword);

                opponentStr = isHome ? displayAway : displayHome;
                if (!opponentStr) opponentStr = "未知";

                opponentField = isHome ? 'away_team' : 'home_team';

                tr.innerHTML += `<td class="editable-cell" contenteditable="false" title="點擊編輯按鈕後可修改">${match.time}</td>`;
                // 【修改】：在 style 中加入 font-size: 1.15rem 與 font-weight: bold，讓單隊賽程的對手名稱更顯眼易讀
                // 【修改】：移除無效的 style，改由 formatTeamName(opponentStr, true) 參數控制放大
                tr.innerHTML += `<td class="editable-cell" contenteditable="false" style="outline:none; vertical-align: middle; padding: 6px 4px; transition: background-color 0.2s;" onblur="saveEdit('${matchId}', '${opponentField}', this.innerText.replace(/\\r?\\n/g, ''))" title="點擊編輯按鈕後可修改">${formatTeamName(opponentStr, true)}</td>`;
            }

            scheduleBody.appendChild(tr);
        }
        i += rowspanCount;
    }
}
// ================= 截圖下載功能 (支援寬表格完整截圖，保留滑桿) =================
document.getElementById('btn-download').addEventListener('click', () => {
    const targetElement = document.getElementById('captureArea');

    // 動態萃取地區名稱 (根據是否為跨區模式改變)
    let regionName = "";
    if (isAllRegionsMode) {
        regionName = "跨區_";
    } else {
        const titleMatch = document.title.match(/年(.+?)慢壘/);
        if (titleMatch) {
            regionName = titleMatch[1] + "_";
        }
    }

    // ====== 【關鍵字：階段三 - 攔截下載按鈕事件】 ======
    let titleText = document.getElementById('captureTitle').textContent.replace(/\s+/g, '');
    // 【修改】將檔名中的箭頭符號刪除，避免手機系統報錯
    titleText = titleText.replace(/〈/g, '').replace(/〉/g, '');
    
    // 【新增】產生時間戳記 (YYMMDD_HHMMSS)
    const now = new Date();
    const ts = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const finalFileName = `${regionName}${titleText}_${ts}.png`;

    // ----------------------------------------------------
    // 👇 新增：在背景發送下載紀錄到 GAS API 👇
    // ----------------------------------------------------
    try {
        // 1. 判斷下載類型 (有跨區字眼為跨區搜尋，有日期格式為單區日期，否則為單區搜尋)
        let downloadType = "單區搜尋";
        if (isAllRegionsMode) downloadType = "跨區搜尋";
        else if (titleText.includes("賽程") && !titleText.includes("區")) downloadType = "單區日期";

        // 2. 整理傳送資料，並過濾掉多餘的字眼，讓報表更乾淨
        const payload = {
            region: isAllRegionsMode ? "跨區" : regionName.replace("_", ""),
            downloadType: downloadType,
            target: titleText.replace("賽程", "").replace("跨區總", "").replace("本區", "")
        };

        // 3. 在背景非同步發送 POST 請求 (不使用 await，以免卡住截圖流程)
        fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: {
                'Content-Type': 'text/plain;charset=utf-8' // 避免 GAS 發生 CORS 阻擋
            }
        })
            .then(res => console.log("✅ 下載紀錄已成功發送至後台"))
            .catch(err => console.error("❌ 下載紀錄發送失敗", err));

    } catch (error) {
        console.error("下載紀錄準備失敗", error);
    }
    // ----------------------------------------------------
    // 👆 新增結束 👆
    // ----------------------------------------------------

    const btn = document.getElementById('btn-download');
    const originalText = btn.textContent;
    btn.textContent = "⏳ 產生圖片中...";
    btn.disabled = true;

    // 💡 1. 紀錄所有原始狀態，包含現在的滑動位置
    const originalOverflowX = targetElement.style.overflowX;
    const originalMaxWidth = targetElement.style.maxWidth;
    const originalWidth = targetElement.style.width;
    const originalScrollLeft = targetElement.scrollLeft;

    // 💡 2. 截圖前：強制展開寬度，並將滑動條推回最左邊，避免右側空白
    targetElement.scrollLeft = 0;
    targetElement.style.overflowX = 'visible';
    targetElement.style.maxWidth = 'none';
    // 改用精確的「數字像素」寬度，取代 max-content，防呆避免寬度變成 0
    targetElement.style.width = targetElement.scrollWidth + 'px';

    // 💡 3. 呼叫 html2canvas
    html2canvas(targetElement, {
        scale: 2,
        backgroundColor: '#ffffff',
        width: targetElement.scrollWidth,  // 再次明確告知畫布要多寬
        height: targetElement.scrollHeight // 明確告知畫布要多高
    }).then(canvas => {
        // 💡 4. 截圖完成，立刻恢復原本「有滑桿」的版面設定！
        targetElement.style.overflowX = originalOverflowX;
        targetElement.style.maxWidth = originalMaxWidth;
        targetElement.style.width = originalWidth;
        targetElement.scrollLeft = originalScrollLeft; // 恢復使用者原本滑動的位置

        canvas.toBlob(function (blob) {
            if (blob === null) {
                alert("圖片產生失敗，請稍後再試！");
                btn.textContent = originalText;
                btn.disabled = false;
                return;
            }
            
            // 【新增】雙重模式分流：精準抓取 FB 與 LINE 內建瀏覽器
            const ua = navigator.userAgent || navigator.vendor || window.opera;
            const isSocialWebView = (ua.indexOf("FBAN") > -1) || (ua.indexOf("FBAV") > -1) || (ua.indexOf("Line") > -1);
            
            if (isSocialWebView) {
                // 【手機社群模式 (LINE/FB)】顯示專屬視窗，提供「關閉」與「分享」按鈕，並加入防呆機制
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = function() {
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.95); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 20px; box-sizing: border-box;';
                    
                    const img = document.createElement('img');
                    img.src = reader.result;
                    // 確保長按功能暢通無阻 (-webkit-touch-callout: default)
                    img.style.cssText = 'max-width:100%; max-height:55vh; border:2px solid white; border-radius:8px; box-shadow:0 0 15px rgba(0,0,0,0.5); margin-bottom: 15px; pointer-events:auto; -webkit-touch-callout:default; user-select:auto;';
                    
                    // 新增：防呆文字提示，讓使用者知道還能「長按」
                    const hintDiv = document.createElement('div');
                    hintDiv.innerHTML = '💡 若按鈕無反應，請直接👆<b style="color:#f1c40f;">長按上方圖片</b>儲存';
                    hintDiv.style.cssText = 'color:white; font-size:1rem; margin-bottom:20px; text-align:center;';

                    // 建立按鈕容器
                    const btnContainer = document.createElement('div');
                    btnContainer.style.cssText = 'display:flex; gap:15px;';

                    // 1. 關閉按鈕
                    const closeBtn = document.createElement('button');
                    closeBtn.innerHTML = '❌ 關閉';
                    closeBtn.style.cssText = 'padding:12px 20px; font-size:1.1rem; border-radius:8px; background:#7f8c8d; color:white; border:none; cursor:pointer; font-weight:bold; box-shadow:0 4px 6px rgba(0,0,0,0.3);';
                    closeBtn.onclick = () => document.body.removeChild(overlay);
                    
                    // 2. 分享按鈕 (加入 Try-Catch 攔截錯誤)
                    const shareBtn = document.createElement('button');
                    shareBtn.innerHTML = '📤 分享 / 儲存';
                    shareBtn.style.cssText = 'padding:12px 20px; font-size:1.1rem; border-radius:8px; background:#3498db; color:white; border:none; cursor:pointer; font-weight:bold; box-shadow:0 4px 6px rgba(0,0,0,0.3);';
                    shareBtn.onclick = async () => {
                        try {
                            // 嘗試建立 File 物件 (某些 LINE 瀏覽器會在這裡報錯導致無反應)
                            const file = new File([blob], finalFileName, { type: 'image/png' });
                            
                            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                                await navigator.share({
                                    files: [file],
                                    title: '賽程表',
                                    text: '分享這張賽程表給球友！'
                                });
                            } else {
                                // 故意拋出錯誤，讓系統進入 catch 區塊顯示警告
                                throw new Error("Share API not supported or files not allowed.");
                            }
                        } catch (err) {
                            // 排除使用者自己按取消的情況 (AbortError)
                            if (err.name !== 'AbortError') {
                                alert('⚠️ 您的 LINE 阻擋了分享功能！\n\n👉 請直接「長按上方圖片」選擇「儲存圖片」。\n👉 或點選右上角選單「以預設瀏覽器開啟」。');
                            }
                        }
                    };

                    btnContainer.appendChild(closeBtn);
                    btnContainer.appendChild(shareBtn);
                    
                    overlay.appendChild(img);
                    overlay.appendChild(hintDiv); // 加入提示文字
                    overlay.appendChild(btnContainer);
                    document.body.appendChild(overlay);
                    
                    btn.textContent = originalText;
                    btn.disabled = false;
                };
            } else {
                // 【一般瀏覽器模式】維持原來的直接下載行為
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = finalFileName;
                link.href = url;
                link.click();
                URL.revokeObjectURL(url);
                
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }, 'image/png'); // 這裡補回了缺少的收尾括號！

    }).catch(err => {
        // 如果發生錯誤，也要把滑桿跟寬度恢復原狀
        targetElement.style.overflowX = originalOverflowX;
        targetElement.style.maxWidth = originalMaxWidth;
        targetElement.style.width = originalWidth;
        targetElement.scrollLeft = originalScrollLeft;

        console.error("截圖失敗", err);
        alert("截圖發生錯誤！");
        btn.textContent = originalText;
        btn.disabled = false;
    });
});
// =========================================================================
// ================= 新增：供點擊卡片球隊時自動轉換表格 =================
function triggerTeamSearch(teamName) {
    // 1. 將點擊的隊伍名稱填入頂部的搜尋輸入框
    document.getElementById('search-input').value = teamName;
    // 2. 直接呼叫我們剛寫好的搜尋與畫表格功能
    renderSearchResult(teamName);

    // 讓網頁自動捲動到最上方，方便看表格
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
// ================= 修改：檢視模式 4：隊伍統計 (優化排除名單) =================
function renderStats() {
    saveState('stats', null);

    // 隱藏截圖區塊與下載按鈕，清空舊容器
    document.getElementById('captureArea').style.display = 'none';
    document.getElementById('btn-download').style.display = 'none';
    const filterContainer = document.getElementById('filter-container');
    if (filterContainer) filterContainer.style.display = 'none';

    const container = document.getElementById('schedule-container');

    // 🏆 新增：加入「組、冠、亞、季、殿、第」等賽程代號關鍵字，避免被算成參賽隊伍
    const ignoreKeywords = [
        "友誼", "挑戰", "新鮮", "清新", "高階", "進階", "准決",
        "組", "冠", "亞", "季", "殿", "第", "勝隊", "敗隊"
    ];

    // 💡 新增：強制放行的特例白名單 (即使包含排除字元也不會被過濾)
    const specialAllow = ["冠緯", "康德科技長春", "羊騷殿"];

    // 1. 計算所有隊伍與場數 (新增合併邏輯)
    const teamStats = {};
    officialData.forEach(match => {
        if (match.status !== 'rain_backup') {
            const teams = [match.home_team, match.away_team];
            teams.forEach(team => {
                if (team && team !== "未知") {
                    // 先清掉開頭的組別代號
                    const cleanTeam = team.replace(/^[A-Z]\d{1,2}/, '').replace(/^\d+[\.．、\s]+/, '').trim();

                    // 💡 判斷邏輯：如果是特例白名單，就強制不忽略
                    let shouldIgnore = false;
                    if (!specialAllow.includes(cleanTeam)) {
                        shouldIgnore = ignoreKeywords.some(keyword => team.includes(keyword)) || /^長春[\d\.]/.test(team);
                    }

                    // 加入 cleanTeam !== "" 的判斷，防止 A1, B3 等純代號變成空字串後被算成隊伍
                    if (!shouldIgnore && cleanTeam !== "") {
                        if (!teamStats[cleanTeam]) teamStats[cleanTeam] = 0;
                        teamStats[cleanTeam]++;
                    }
                }
            });
        }
    });

    // 2. 轉換為陣列並排序 (依場次多到少排列，相同場數則依筆畫或字母順序)
    const sortedTeams = Object.keys(teamStats).map(team => ({
        name: team,
        count: teamStats[team]
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-TW'));

    // 3. 準備繪製：計算對半切的數量
    const totalTeams = sortedTeams.length;
    const halfIndex = Math.ceil(totalTeams / 2);
    const leftTeams = sortedTeams.slice(0, halfIndex);
    const rightTeams = sortedTeams.slice(halfIndex);

    let html = `<div style="padding: 5px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); width: 100%; box-sizing: border-box;">`;
    html += `<h3 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 5px; font-size: 1.2rem; text-align: center;">📊 聯賽隊伍數據統計</h3>`;
    html += `<p style="font-size: 1.1rem; font-weight: bold; color: #e67e22; margin-bottom: 5px; text-align: center;">🏆 總計參賽隊伍：${totalTeams} 隊</p>`;

    html += `
    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 1.1rem; table-layout: fixed;">
        <thead>
            <tr>
                <th style="background-color: #e0e6ed; color: #2c3e50; padding: 3px 0; border: 1px solid #bdc3c7; width: 40%; text-align: center;">隊伍名稱</th>
                <th style="background-color: #e0e6ed; color: #2c3e50; padding: 3px 0; border: 1px solid #bdc3c7; width: 10%; text-align: center;">場數</th>
                <th style="background-color: #e0e6ed; color: #2c3e50; padding: 3px 0; border: 1px solid #bdc3c7; width: 40%; text-align: center;">隊伍名稱</th>
                <th style="background-color: #e0e6ed; color: #2c3e50; padding: 3px 0; border: 1px solid #bdc3c7; width: 10%; text-align: center;">場數</th>
            </tr>
        </thead>
        <tbody>
    `;

    for (let i = 0; i < halfIndex; i++) {
        const left = leftTeams[i];
        const right = rightTeams[i];

        // 【修改】移除 <tr> 的 onmouseover，避免整列變色
        html += `<tr>`;

        if (left) {
            // 【修改】加上 class="stat-team-cell"，只有滑鼠指到隊伍名稱這格才會變色
            html += `
                <td class="stat-team-cell" style="padding: 3px 0; border: 1px solid #bdc3c7; font-weight: bold; color: #3498db; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" onclick="triggerTeamSearch('${left.name}')">${left.name}</td>
                <td style="padding: 3px 0; border: 1px solid #bdc3c7; font-weight: bold; color: #2c3e50; text-align: center;">${left.count}</td>
            `;
        }

        if (right) {
            // 【修改】同上
            html += `
                <td class="stat-team-cell" style="padding: 3px 0; border: 1px solid #bdc3c7; font-weight: bold; color: #3498db; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" onclick="triggerTeamSearch('${right.name}')">${right.name}</td>
                <td style="padding: 3px 0; border: 1px solid #bdc3c7; font-weight: bold; color: #2c3e50; text-align: center;">${right.count}</td>
            `;
        } else {
            html += `
                <td style="padding: 3px 0; border: 1px solid #bdc3c7;"></td>
                <td style="padding: 3px 0; border: 1px solid #bdc3c7;"></td>
            `;
        }

        html += `</tr>`;
    }

    html += `</tbody></table></div>`;
    container.innerHTML = html;
}
// ================= 新增：1 小時暫存機制 (第三批次) =================
const CACHE_KEY = 'softball_schedule_edits';
const CACHE_EXPIRE_MS = 60 * 60 * 1000; // 1小時 = 3600000 毫秒

// 讀取暫存資料
function getCache() {
    try {
        const cacheStr = localStorage.getItem(CACHE_KEY);
        if (!cacheStr) return {};
        const cache = JSON.parse(cacheStr);

        // 檢查是否超過 1 小時，過期就清空
        if (Date.now() - cache.timestamp > CACHE_EXPIRE_MS) {
            localStorage.removeItem(CACHE_KEY);
            return {};
        }
        return cache.data || {};
    } catch (e) {
        console.error("讀取暫存失敗", e);
        return {};
    }
}

// 儲存修改內容
function saveEdit(matchId, field, value) {
    const data = getCache();

    if (!data[matchId]) {
        data[matchId] = {};
    }

    // 更新該場比賽的特定欄位 (去除頭尾多餘空白)
    data[matchId][field] = value.trim();

    // 儲存回 localStorage 並更新「最後修改時間戳記」
    localStorage.setItem(CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: data
    }));
}

// ===============================================================
// ================= 第四批次：晉級設定與下拉選單功能 =================
// ===============================================================

// 1. 動態在導覽列新增「晉級設定」按鈕 (不用改 HTML 檔案)
const navContainer = document.querySelector('.nav-container');
if (navContainer && !document.getElementById('btn-advancement')) {
    const advBtn = document.createElement('button');
    advBtn.className = 'sys-btn';
    advBtn.id = 'btn-advancement';
    advBtn.textContent = '晉級';
    navContainer.appendChild(advBtn);

    // 綁定點擊事件 (修改為建構中鎖定狀態)
    advBtn.style.opacity = '0.5';
    advBtn.style.cursor = 'not-allowed';
    advBtn.innerHTML = '晉級 🔒'; // 將文字簡化為「晉級」

    advBtn.addEventListener('click', (e) => {
        alert('此功能建構中，敬請期待！');
    });

    // ================= 新增：日期模式切換開關 (ON/OFF 樣式) =================
    const switchContainer = document.createElement('div');
    switchContainer.id = 'date-view-switch';
    switchContainer.className = 'segmented-control';
    // 【修改】因為網頁一打開就是在日期頁面，所以直接讓它預設顯示
    switchContainer.style.display = 'inline-flex';

    const btnSplit = document.createElement('button');
    btnSplit.className = 'segmented-btn active'; // 預設「雙欄」亮起
    btnSplit.textContent = '雙欄';

    const btnGrid = document.createElement('button');
    btnGrid.className = 'segmented-btn';
    btnGrid.textContent = '全部';

    switchContainer.appendChild(btnSplit);
    switchContainer.appendChild(btnGrid);

    // 關鍵：將這組開關插入在「隊伍 (btn-view-stats)」按鈕的前面，這樣就會在「日期」的正旁邊
    const statsBtn = document.getElementById('btn-view-stats');
    if (statsBtn) {
        navContainer.insertBefore(switchContainer, statsBtn);
    }

    // 綁定「雙欄」點擊事件
    btnSplit.addEventListener('click', () => {
        if (dateViewMode === 'split') return; // 如果已經是雙欄就不動作
        dateViewMode = 'split';
        btnSplit.classList.add('active');
        btnGrid.classList.remove('active');
        renderByDate();
    });

    // 綁定「全部」點擊事件
    btnGrid.addEventListener('click', () => {
        if (dateViewMode === 'grid') return; // 如果已經是全部就不動作
        dateViewMode = 'grid';
        btnGrid.classList.add('active');
        btnSplit.classList.remove('active');
        renderByDate();
    });
    // ==========================================================

    // 2. 覆寫原本的「返回」按鈕邏輯，讓它可以支援從晉級設定頁面返回
    const oldBackBtn = document.getElementById('btn-back');
    const newBackBtn = oldBackBtn.cloneNode(true);
    oldBackBtn.parentNode.replaceChild(newBackBtn, oldBackBtn);

    newBackBtn.addEventListener('click', () => {
        if (viewHistory.length > 1) {
            viewHistory.pop(); // 丟棄當前畫面
            const prev = viewHistory[viewHistory.length - 1]; // 取得前一個畫面
            isBacking = true; // 標記為回上頁，避免重複紀錄

            // 恢復頂部按鈕的亮起狀態
            document.querySelectorAll('.sys-btn').forEach(btn => btn.classList.remove('active'));
            if (prev.action.includes('date')) document.getElementById('btn-view-date').classList.add('active');
            if (prev.action === 'stats') document.getElementById('btn-view-stats').classList.add('active');
            if (prev.action === 'advancement') document.getElementById('btn-advancement').classList.add('active');

            // 根據紀錄還原畫面
            if (prev.action === 'dateMenu') renderByDate();
            else if (prev.action === 'dateTable') drawDateTable(prev.param);
            else if (prev.action === 'search') {
                document.getElementById('search-input').value = prev.param;
                renderSearchResult(prev.param);
            }
            else if (prev.action === 'stats') renderStats();
            else if (prev.action === 'advancement') renderAdvancementSetup();
        } else {
            // 若沒有上一頁，直接回首頁
            window.location.href = 'softball_index.html';
        }
    });
}

// 3. 核心功能：繪製「晉級隊伍線上預排」專屬頁面
function renderAdvancementSetup() {
    saveState('advancement', null);

    // 隱藏截圖按鈕與篩選區
    document.getElementById('captureArea').style.display = 'none';
    document.getElementById('btn-download').style.display = 'none';
    const filterContainer = document.getElementById('filter-container');
    if (filterContainer) filterContainer.style.display = 'none';

    const container = document.getElementById('schedule-container');

    // 1. 把 "長春" 從陣列中移除
    const ignoreKeywords = ["友誼", "挑戰", "新鮮", "清新", "高階", "進階", "准決", "組", "冠", "亞", "季", "殿", "第", "勝隊", "敗隊"];

    // 💡 新增：強制放行的特例白名單
    const specialAllow = ["冠緯", "康德科技長春", "羊騷殿"];

    // 2. 整理「真實參賽隊伍」名單時，加上正則表達式阻擋
    const realTeams = new Set();
    officialData.forEach(match => {
        if (match.status !== 'rain_backup') {
            [match.home_team, match.away_team].forEach(team => {
                if (team && team !== "未知") {
                    const cleanTeam = team.replace(/^[A-Z]\d{1,2}/, '').replace(/^\d+[\.．、\s]+/, '').trim();

                    let shouldIgnore = false;
                    if (!specialAllow.includes(cleanTeam)) {
                        shouldIgnore = ignoreKeywords.some(keyword => team.includes(keyword)) || /^長春[\d\.]/.test(team);
                    }

                    // 加入 cleanTeam !== "" 的判斷，避免將純代號加入真實晉級隊伍的選項中
                    if (!shouldIgnore && cleanTeam !== "") {
                        realTeams.add(team);
                    }
                }
            });
        }
    });
    const sortedTeams = Array.from(realTeams).sort((a, b) => a.localeCompare(b, 'zh-TW'));

    // 3. 篩選「待定賽事 (TBD)」時，加上正則表達式捕捉
    const tbdMatches = [];
    officialData.forEach(match => {
        if (match.status !== 'rain_backup') {
            // 只要符合 ignoreKeywords 或是 長春代號 格式，就判定為待定
            const homeTBD = ignoreKeywords.some(kw => (match.home_team || '').includes(kw)) || /^長春[\d\.]/.test(match.home_team || '');
            const awayTBD = ignoreKeywords.some(kw => (match.away_team || '').includes(kw)) || /^長春[\d\.]/.test(match.away_team || '');

            if (homeTBD || awayTBD) {
                tbdMatches.push({ match, homeTBD, awayTBD });
            }
        }
    });

    // 取得目前的暫存紀錄 (與第三批次共用)
    const cachedEdits = getCache();

    // 準備畫出操作介面
    let html = `<div style="padding: 15px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); width: 100%; box-sizing: border-box;">`;
    html += `<h3 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; font-size: 1.2rem; text-align: center;">⚙️ 晉級隊伍線上預排</h3>`;
    html += `<p style="font-size: 1rem; color: #7f8c8d; text-align: center; margin-bottom: 20px;">請從下拉選單指派晉級隊伍。<br>選擇後會自動暫存 1 小時，並同步顯示於「日期檢視」表格中。</p>`;

    if (tbdMatches.length === 0) {
        html += `<div style="text-align:center; padding: 20px; color: #27ae60; font-weight: bold; font-size: 1.1rem;">目前系統中沒有任何待定賽程！</div>`;
    } else {
        html += `<div style="display:flex; flex-direction:column; gap:15px;">`;
        tbdMatches.forEach(({ match, homeTBD, awayTBD }) => {
            const matchId = `${match.date}_${match.time}_${match.location}`;
            const cachedMatch = cachedEdits[matchId] || {};

            // 如果已經有暫存，就顯示暫存的隊伍；否則顯示原始代號
            const currentHome = cachedMatch.home_team !== undefined ? cachedMatch.home_team : match.home_team;
            const currentAway = cachedMatch.away_team !== undefined ? cachedMatch.away_team : match.away_team;

            html += `<div style="border: 1px solid #e0e6ed; border-radius: 8px; padding: 15px; background-color: #f8f9fa;">`;
            html += `<div style="font-size: 1rem; font-weight: bold; color: #34495e; margin-bottom: 10px; text-align: center;">📅 ${match.date} &nbsp;|&nbsp; ⏰ ${match.time} &nbsp;|&nbsp; 📍 ${match.location}</div>`;
            html += `<div style="display: flex; align-items: center; justify-content: center; gap: 10px;">`;

            // 產生下拉選單的函數
            const buildSelect = (field, originalValue, currentValue, isTBD) => {
                // 若這個欄位已經是確定隊伍(非待定)，顯示純文字即可
                if (!isTBD) {
                    return `<div style="flex:1; text-align:center; font-weight:bold; color:#2c3e50; background:#e0e6ed; padding:10px; border-radius:5px; font-size:1.1rem;">${originalValue}</div>`;
                }

                // 若是待定賽程，產生下拉選單並綁定 saveEdit 暫存功能
                let selectHtml = `<select style="flex:1; padding:8px; border:2px solid #3498db; border-radius:5px; font-size:1rem; text-align:center; background:white; cursor:pointer;" 
                                  onchange="saveEdit('${matchId}', '${field}', this.value);">`;

                // 第一個預設選項 (顯示原本的代號，例如「A組第一」)
                selectHtml += `<option value="${originalValue}" ${currentValue === originalValue ? 'selected' : ''}>-- ${originalValue} --</option>`;

                // 放入所有實體隊伍
                sortedTeams.forEach(team => {
                    selectHtml += `<option value="${team}" ${currentValue === team ? 'selected' : ''}>${team}</option>`;
                });
                selectHtml += `</select>`;
                return selectHtml;
            };

            // 【自動判斷】根據地區組合下拉選單的順序
            if (document.title.includes('樹林') || document.title.includes('五股')) {
                // 樹林、五股：客隊(away)在左
                html += buildSelect('away_team', match.away_team, currentAway, awayTBD);
                html += `<div style="font-weight:bold; color:#e74c3c; font-size:1.1rem;">VS</div>`;
                html += buildSelect('home_team', match.home_team, currentHome, homeTBD);
            } else {
                // 三重、新莊：主隊(home)在左
                html += buildSelect('home_team', match.home_team, currentHome, homeTBD);
                html += `<div style="font-weight:bold; color:#e74c3c; font-size:1.1rem;">VS</div>`;
                html += buildSelect('away_team', match.away_team, currentAway, awayTBD);
            }

            html += `</div></div>`;
        });
        html += `</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
}
// ===============================================================

// 補回首頁按鈕的跳轉邏輯
document.getElementById('btn-home').addEventListener('click', () => {
    window.location.href = 'softball_index.html';
});
