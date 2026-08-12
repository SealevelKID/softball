// 全域狀態：儲存官方唯讀總表
let officialData = [];

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

// 初始化系統
async function initSystem() {
    try {
        const response = await fetch('schedule.json');
        if (!response.ok) throw new Error('無法讀取 JSON');
        
        officialData = await response.json();
        
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

        // ================= 新增：綁定首頁與回上一頁事件 =================
        document.getElementById('btn-home').addEventListener('click', () => {
            document.getElementById('search-input').value = '';
            viewHistory = []; // 清空歷史
            document.querySelectorAll('.sys-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById('btn-view-date').classList.add('active');
            renderByDate(); // 回到最原始的按日期檢視
        });

        document.getElementById('btn-back').addEventListener('click', () => {
            if (viewHistory.length > 1) {
                viewHistory.pop(); // 丟棄當前畫面
                const prev = viewHistory[viewHistory.length - 1]; // 取得前一個畫面
                isBacking = true; // 標記為回上頁，避免再次被記錄
                
                // 恢復頂部按鈕的 Active 狀態 (已移除 loc 相關判斷)
                document.querySelectorAll('.sys-btn').forEach(btn => btn.classList.remove('active'));
                if (prev.action.includes('date')) document.getElementById('btn-view-date').classList.add('active');
                if (prev.action === 'stats') document.getElementById('btn-view-stats').classList.add('active');

                // 根據紀錄還原畫面 (已移除 locMenu 與 locTable)
                if (prev.action === 'dateMenu') renderByDate();
                else if (prev.action === 'dateTable') drawDateTable(prev.param);
                else if (prev.action === 'search') {
                    document.getElementById('search-input').value = prev.param;
                    renderSearchResult(prev.param);
                }
                else if (prev.action === 'stats') renderStats();
            } else {
                // 若沒有上一頁，直接回首頁
                document.getElementById('btn-home').click();
            }
        });
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
            `<div style="color:red; text-align:center; padding:20px;">資料載入失敗，請確認 schedule.json 是否存在。</div>`;
    }
}

// 切換按鈕的 Active 樣式 (修復藍色卡住的問題)
function setActiveButton(clickedBtn) {
    // 將原本的 capsule-btn 改成新的 sys-btn
    document.querySelectorAll('.sys-btn').forEach(btn => btn.classList.remove('active'));
    if (clickedBtn) {
        clickedBtn.classList.add('active');
    }
}

// 檢視模式 1：按日期檢視 (改為生成日期選單)
function renderByDate() {
    saveState('dateMenu', null);
    document.getElementById('captureArea').style.display = 'none';
    document.getElementById('btn-download').style.display = 'none';
    document.getElementById('schedule-container').innerHTML = ''; 

    const filterContainer = document.getElementById('filter-container');
    filterContainer.style.display = 'flex';
    filterContainer.innerHTML = ''; 

    // 取得所有不重複的日期並排序
    const dates = [...new Set(officialData.map(match => match.date))].sort();

    dates.forEach(date => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.textContent = date;
        btn.onclick = () => {
            // 切換按鈕亮起狀態
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // 畫出該日期的專屬表格
            drawDateTable(date);
        };
        filterContainer.appendChild(btn);
    });
}

// 核心功能 A：繪製「特定日期」的表格 (時間 | 三重A | 三重B)
function drawDateTable(selectedDate) {
    saveState('dateTable', selectedDate);
    const captureArea = document.getElementById('captureArea');
    const scheduleHead = document.getElementById('scheduleHead');
    const scheduleBody = document.getElementById('scheduleBody');
    const title = document.getElementById('captureTitle');

    captureArea.style.display = 'block';
    document.getElementById('btn-download').style.display = 'inline-block';
    title.textContent = `${selectedDate} 賽程`; // 設定截圖用的大標題

    const matches = officialData.filter(m => m.date === selectedDate);
    const locations = [...new Set(matches.map(m => m.location))].sort();
    const times = [...new Set(matches.map(m => m.time))].sort();

    // 建立動態表頭
    let headHTML = `<th>時間</th>`;
    locations.forEach(loc => { headHTML += `<th colspan="2">${loc}</th>`; });
    scheduleHead.innerHTML = headHTML;

    // 建立表格內容
    scheduleBody.innerHTML = '';
    times.forEach(time => {
        let rowHTML = `<td>${time}</td>`;
        
        locations.forEach(loc => {
            const match = matches.find(m => m.time === time && m.location === loc);
            if (match) {
                if (match.status === 'rain_backup') {
                    rowHTML += `<td colspan="2" style="color:#e67e22;">${match.note}</td>`;
                } else {
                    // 隊伍名稱保留點擊搜尋功能
                    rowHTML += `<td class="clickable-tag" onclick="triggerTeamSearch('${match.home_team}')">${match.home_team}</td>`;
                    rowHTML += `<td class="clickable-tag" onclick="triggerTeamSearch('${match.away_team}')">${match.away_team}</td>`;
                }
            } else {
                rowHTML += `<td></td><td></td>`; // 無賽事留空
            }
        });
        scheduleBody.innerHTML += `<tr>${rowHTML}</tr>`;
    });
}

// 共用元件：產生單一賽程卡片 DOM
function createMatchCard(match, headerType) {
    const card = document.createElement('div');
    card.className = 'card';
    
    // 根據目前的檢視模式，決定右上角要顯示場地還是日期
    const topRightInfo = headerType === 'location' 
        ? `<span class="clickable-tag" onclick="alert('場地：${match.location}')">📍 ${match.location}</span>` 
        : `<span class="clickable-tag" onclick="alert('日期：${match.date}')">📅 ${match.date}</span>`;

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
        // ▼ 這裡的 onclick 已經改為觸發 triggerTeamSearch
        card.innerHTML = `
            <div class="card-header">
                <span>⏰ ${match.time}</span>
                ${topRightInfo}
            </div>
            <div class="card-body">
                <span class="clickable-tag" onclick="triggerTeamSearch('${match.home_team}')">${match.home_team}</span> 
                vs 
                <span class="clickable-tag" onclick="triggerTeamSearch('${match.away_team}')">${match.away_team}</span>
            </div>
        `;
    }
    return card;
}

// 啟動應用程式
initSystem();

// 檢視模式 3：搜尋結果 (動態表頭與標題)
function renderSearchResult(keyword) {
    saveState('search', keyword);
    const container = document.getElementById('schedule-container');
    const captureArea = document.getElementById('captureArea');
    const scheduleHead = document.getElementById('scheduleHead');
    const scheduleBody = document.getElementById('scheduleBody');
    const title = document.getElementById('captureTitle');
    const filterContainer = document.getElementById('filter-container');
    const downloadBtn = document.getElementById('btn-download');
    
    // 清空舊的卡片區與按鈕 active 狀態，並隱藏子選單
    container.innerHTML = ''; 
    document.querySelectorAll('.sys-btn, .filter-btn').forEach(btn => btn.classList.remove('active'));
    if(filterContainer) filterContainer.style.display = 'none';

    // 💡 修改為「完全一致 (===)」精準對位，避免抓到名字相似的分支隊伍
    const results = officialData.filter(match => 
        (match.home_team && match.home_team === keyword) || 
        (match.away_team && match.away_team === keyword)
    );

    // 如果找不到資料
    if (results.length === 0) {
        captureArea.style.display = 'none';
        downloadBtn.style.display = 'none';
        container.innerHTML = `<div style="text-align:center; padding:20px; color:#7f8c8d;">找不到與「${keyword}」相關的賽程。</div>`;
        return;
    }

    // 找到資料：顯示表格與下載按鈕，並設定動態標題與表頭
    captureArea.style.display = 'block';
    downloadBtn.style.display = 'inline-block';
    title.textContent = `${keyword} 所有賽程`; 
    scheduleHead.innerHTML = `<th>日期</th><th>地點</th><th>時間</th><th>對手</th>`;
    scheduleBody.innerHTML = ''; 

    // 處理合併儲存格 (rowspan) 邏輯
    let i = 0;
    while (i < results.length) {
        let currentMatch = results[i];
        let rowspanCount = 1;
        let j = i + 1;
        
        // 如果連著的幾場都在「同一天」且「同一個場地」，就把格數加起來
        while (j < results.length && 
               results[j].date === currentMatch.date && 
               results[j].location === currentMatch.location) {
            rowspanCount++;
            j++;
        }

        // 把這幾場比賽畫進表格裡
        for (let k = 0; k < rowspanCount; k++) {
            const match = results[i + k];
            const tr = document.createElement('tr');
            
            // 第一列才需要印出「日期」與「地點」，並設定跨列 (rowspan)
            if (k === 0) {
                // 將日期轉換為較簡短的格式 (例如：2026-08-23 轉為 8月23日)
                const dateObj = new Date(match.date);
                const formattedDate = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
                
                // 加入 contenteditable="true" 讓它可編輯
                tr.innerHTML += `<td rowspan="${rowspanCount}" contenteditable="true" title="點擊可修改">${formattedDate}</td>`;
                tr.innerHTML += `<td rowspan="${rowspanCount}" contenteditable="true" title="點擊可修改">${match.location}</td>`;
            }
            
            // 判斷對手名稱
            let opponentStr = "";
            if (match.status === 'rain_backup') {
                 opponentStr = match.note || "雨備日"; 
            } else {
                 // 💡 同樣修改為「完全一致 (===)」判斷主客隊
                 let isHome = (match.home_team && match.home_team === keyword);
                 opponentStr = isHome ? match.away_team : match.home_team;
                 if(!opponentStr) opponentStr = "未知"; 
            }

            // 加入時間與對手欄位 (加入 contenteditable="true"，並拿掉 clickable-tag 與 onclick)
            tr.innerHTML += `<td contenteditable="true" title="點擊可修改">${match.time}</td>`;
            tr.innerHTML += `<td contenteditable="true" title="點擊可修改">${opponentStr}</td>`;
            
            scheduleBody.appendChild(tr);
        }
        i += rowspanCount; // 跳過已經合併過的列
    }
}
// ================= 截圖下載功能 (自動抓取標題命名) =================
document.getElementById('btn-download').addEventListener('click', () => {
    const targetElement = document.getElementById('captureArea');
    // 直接抓取畫面上的動態標題文字來當作檔名，並移除空白
    const titleText = document.getElementById('captureTitle').textContent.replace(/\s+/g, '');
    const btn = document.getElementById('btn-download');
    
    // 改變按鈕狀態，提示正在處理
    const originalText = btn.textContent;
    btn.textContent = "⏳ 產生圖片中...";
    btn.disabled = true;

    // 呼叫 html2canvas 進行截圖
    html2canvas(targetElement, {
        scale: 2, 
        backgroundColor: '#ffffff'
    }).then(canvas => {
        // 建立下載連結
        const link = document.createElement('a');
        // 這樣檔名就會變成 "8月30日賽程.png" 或是 "夯DEEP所有賽程.png"
        link.download = `${titleText}.png`; 
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        // 恢復按鈕
        btn.textContent = originalText;
        btn.disabled = false;
    }).catch(err => {
        console.error("截圖失敗", err);
        alert("截圖發生錯誤！");
        btn.textContent = originalText;
        btn.disabled = false;
    });
});
// ================= 新增：供點擊卡片球隊時自動轉換表格 =================
function triggerTeamSearch(teamName) {
    // 1. 將點擊的隊伍名稱填入頂部的搜尋輸入框
    document.getElementById('search-input').value = teamName;
    // 2. 直接呼叫我們剛寫好的搜尋與畫表格功能
    renderSearchResult(teamName);
    
    // 讓網頁自動捲動到最上方，方便看表格
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
// ================= 修改：檢視模式 4：隊伍統計 (阿伯友善：大字體、極度縮減空白) =================
function renderStats() {
    saveState('stats', null);
    
    // 隱藏截圖區塊與下載按鈕，清空舊容器
    document.getElementById('captureArea').style.display = 'none';
    document.getElementById('btn-download').style.display = 'none';
    const filterContainer = document.getElementById('filter-container');
    if (filterContainer) filterContainer.style.display = 'none';
    
    const container = document.getElementById('schedule-container');

    // 🏆 定義要排除的比賽代號關鍵字
    const ignoreKeywords = ["友誼", "挑戰", "新鮮", "清新", "長春", "高階", "進階", "准決"];

    // 1. 計算所有隊伍與場數
    const teamStats = {};
    officialData.forEach(match => {
        if (match.status !== 'rain_backup') {
            const teams = [match.home_team, match.away_team];
            teams.forEach(team => {
                if (team && team !== "未知") {
                    const shouldIgnore = ignoreKeywords.some(keyword => team.includes(keyword));
                    if (!shouldIgnore) {
                        if (!teamStats[team]) teamStats[team] = 0;
                        teamStats[team]++;
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
    
    // 💡 縮減外層容器的 padding (從 10px 降到 5px，節省螢幕邊緣空間)
    let html = `<div style="padding: 5px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); width: 100%; box-sizing: border-box;">`;
    // 標題字體同步放大
    html += `<h3 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 5px; font-size: 1.2rem; text-align: center;">📊 聯賽隊伍數據統計</h3>`;
    html += `<p style="font-size: 1.1rem; font-weight: bold; color: #e67e22; margin-bottom: 5px; text-align: center;">🏆 總計參賽隊伍：${totalTeams} 隊</p>`;
    
    // 💡 關鍵修改 1：字體全面放大到 1.1rem
    // 💡 關鍵修改 2：調整欄寬比例 (隊名佔 40%，數字只需 10%)
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
    
    // 透過迴圈，每一次畫出「一整列 (包含左右兩隊)」
    for (let i = 0; i < halfIndex; i++) {
        const left = leftTeams[i];
        const right = rightTeams[i];
        
        html += `<tr style="transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#f1f2f6'" onmouseout="this.style.backgroundColor='transparent'">`;
        
        // 💡 關鍵修改 3：將所有 <td> 的 padding 壓縮到 3px 0
        // 畫左半邊
        if (left) {
            html += `
                <td style="padding: 3px 0; border: 1px solid #bdc3c7; font-weight: bold; color: #3498db; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" onclick="triggerTeamSearch('${left.name}')">${left.name}</td>
                <td style="padding: 3px 0; border: 1px solid #bdc3c7; font-weight: bold; color: #2c3e50; text-align: center;">${left.count}</td>
            `;
        }
        
        // 畫右半邊
        if (right) {
            html += `
                <td style="padding: 3px 0; border: 1px solid #bdc3c7; font-weight: bold; color: #3498db; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" onclick="triggerTeamSearch('${right.name}')">${right.name}</td>
                <td style="padding: 3px 0; border: 1px solid #bdc3c7; font-weight: bold; color: #2c3e50; text-align: center;">${right.count}</td>
            `;
        } else {
            // 右下角補空缺
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
