/* Locale catalog and non-destructive rendering for the management console. */
    'use strict';

    // Each row is: original interface text | English | Traditional Chinese.
    // A missing third column means the original is already Traditional Chinese.
    // Keep protocol names, units, account IDs and hardware payloads unchanged.
    const CONSOLE_TRANSLATIONS = `
水面智慧浮動太陽能發電系統 - 管理控制台|Smart Floating Solar Power System — Management Console
Generation System Dashboard 發電系統控制台|Generation System Dashboard|發電系統控制台
System Overview 系統總覽|System Overview|系統總覽
裝置總數 Total Devices|Total Devices|裝置總數
運行中 Active|Active|運行中
待機中 Idle|Idle|待機中
離線 Offline|Offline|離線
Real-time Output 即時輸出|Real-time Output|即時輸出
目前輸出 Current Output|Current Output|目前輸出
尖峰負載 Peak Load|Peak Load|尖峰負載
累計發電 Power Log|Total Generation|累計發電
Network Comm 網絡連接|Network Connection|網絡連接
通訊狀態 Comm Status|Communication Status|通訊狀態
通道協定 Protocol|Protocol|通道協定
數據模式 Mode|Data Mode|數據模式
中繼基站 Gateway|Gateway|中繼基站
已接收封包 Packets|Received Packets|已接收封包
BASE 基站 (ESP-NOW 網關)|Base Station (ESP-NOW Gateway)|基站（ESP-NOW 網關）
SIMULATION 模擬|SIMULATION|模擬模式
HARDWARE LIVE 直連硬體|HARDWARE LIVE|硬體直連
Reservoir Storage 水庫儲存|Reservoir Storage|水庫儲存
Running Status 運行狀態|Operating Status|運行狀態
Daily Generated 日發電量|Daily Generation|日發電量
System Performance 系統效能|System Performance|系統效能
運行時間 Uptime|Uptime|運行時間
平均輸出 Avg Output|Average Output|平均輸出
最後更新 Last Update|Last Updated|最後更新
Device Management 裝置管理|Device Management|裝置管理
Storage Monitor 儲存監控|Storage Monitor|儲存監控
電池陣列 Battery Array|Battery Array|電池陣列
水庫蒸發抑制 Reservoir|Reservoir Evaporation Reduction|水庫蒸發抑制
降溫效益 Cooling|Cooling Benefits|降溫效益
Power Generation Log 發電日誌|Power Generation Log|發電日誌
Alert Log 警報日誌|Alert Log|警報日誌
INFO 一般通知|Information|一般通知
WARNING 警告|Warning|警告
DANGER 危險|Danger|危險
System Settings 系統設定|System Settings|系統設定
基本設定 Basic|Basic Settings|基本設定
通訊設定 ESP-NOW & Hardware|Communication & Hardware|通訊與硬體設定
硬體設定 Buck Circuit|Buck Circuit Settings|降壓電路設定
通知設定 Notification|Notification Settings|通知設定
使用者與身分權限管理 User Accounts & RBAC|User Accounts & Permissions|使用者與身分權限管理
SAVE 儲存變更|Save Changes|儲存變更
使用者帳號 / Username|Username|使用者帳號
密碼 / Password|Password|密碼
原密碼 / Current Password|Current Password|原密碼
新密碼 / New Password|New Password|新密碼
確認新密碼 / Confirm New Password|Confirm New Password|確認新密碼
VERIFY & LOGIN 驗證登入|Verify & Sign In|驗證登入
ACCESS GRANTED 驗證通過|Access Granted|驗證通過
鎖定螢幕 Lock Screen|Lock Screen|鎖定螢幕
安全登出 Logout|Sign Out|安全登出
全權控制 (All)|Full Access|全權控制
系統設定 (Admin)|System Settings|系統設定
硬體開關 (Control)|Hardware Control|硬體開關
裝置新增 (Add Device)|Add Devices|裝置新增
數據檢視 (Read-Only)|View Data (Read-Only)|數據檢視（唯讀）
目前登入中 (Active)|Currently Signed In|目前登入中
Web Serial 傳輸率 (Baud Rate)|Web Serial Baud Rate|Web Serial 傳輸率
基站韌體 (Gateway .ino)|Gateway Firmware (.ino)|基站韌體（.ino）
水面模組 (Solar Node .ino)|Solar Node Firmware (.ino)|水面模組韌體（.ino）
接線與燒錄說明 (Guide)|Wiring & Flashing Guide|接線與燒錄說明
ESP-NOW 實體通訊數據流監視器 (Web Serial / WebSocket Stream)|ESP-NOW Live Data Monitor (Web Serial / WebSocket)|ESP-NOW 實體通訊數據流監視器（Web Serial / WebSocket）
ESP-NOW 通訊終端機 (Packet Monitor)|ESP-NOW Packet Monitor|ESP-NOW 通訊終端機
系統總覽|System Overview
裝置管理|Device Management
儲存監控|Storage Monitor
發電日誌|Generation Log
警報日誌|Alert Log
系統設定|System Settings
現場環境|Site Environment
產生蜂窩|Generate Array
最佳連接路徑|Optimize Connection Path
顯示標籤|Show Labels
ID 模式|ID View|編號模式
功率模式|Power View
溫度模式|Temperature View
訊號模式|Signal View
全部啟動|Enable All
全部停止|Disable All
點擊切換模式|Click to switch mode
連線端點：|Endpoint:
未連接 (模擬模式)|Disconnected (Simulation)
未連接 (模擬模式運行中)|Disconnected (Simulation Running)
連線 ESP32 (USB Serial)|Connect ESP32 (USB Serial)
斷開 ESP32 (USB)|Disconnect ESP32 (USB)
Wi-Fi 網關 (WebSocket)|Wi-Fi Gateway (WebSocket)
檢視即時 ESP-NOW 數據封包終端機|View live ESP-NOW packets
檢視與下載 ESP32 韌體程式碼|View and download ESP32 firmware
模擬注入一筆真實 ESP32 遙測封包|Inject a sample ESP32 telemetry packet
通訊終端|Terminal
ESP32 韌體|ESP32 Firmware
注入測試|Inject Test Packet
整體狀態:|Overall Status:
新增裝置|Add Device
匯出|Export
重新整理|Refresh
裝置 ID|Device ID|裝置編號
座標位置|Coordinates
狀態|Status
電壓 (V)|Voltage (V)
溫度 (°C)|Temperature (°C)
訊號|Signal
發電量 (kWh)|Energy Generated (kWh)
最後回報|Last Report
操作|Actions
總容量|Total Capacity
目前儲存|Stored Energy
充電狀態|Charging Status
充電中|Charging
覆蓋率|Surface Coverage
節水量 (日)|Daily Water Savings
水面溫度|Water Temperature
面板均溫|Average Panel Temperature
對比空氣溫|Compared with Air Temperature
效率提升|Efficiency Improvement
儲能趨勢圖 (近 7 日)|Energy Storage Trend (Last 7 Days)
電池儲存量 (kWh)|Battery Storage (kWh)
實際發電量 (kWh)|Actual Generation (kWh)
今日發電|Generation Today
本週累計|Weekly Total
本月累計|Monthly Total
減碳量|Carbon Reduction
噸 CO₂|tonnes CO₂
時間|Time
輸出電壓 (V)|Output Voltage (V)
輸出電流 (A)|Output Current (A)
效率|Efficiency
警報清單 (點擊確認 / 雙擊過濾)|Alerts (Click to Acknowledge / Double-click to Filter)
全部顯示|Show All
全部確認|Acknowledge All
DANGER 面板過熱|DANGER — Panel Overheating|危險：面板過熱
WARNING 訊號強度下降|WARNING — Weak Signal|警告：訊號強度下降
WARNING 訊號下降|WARNING — Weak Signal|警告：訊號下降
WARNING 電壓波動|WARNING — Voltage Fluctuation|警告：電壓波動
INFO 歐亞路徑完成|INFO — Route Verification Complete|資訊：路徑驗證完成
INFO 系統開機|INFO — System Started|資訊：系統開機
模組 ID-05 面板溫度達到 62.5°C，已超過安全臨界值 (60°C)，請立即檢視散熱狀態。|Module ID-05 has reached 62.5°C, above the 60°C safety threshold. Check cooling immediately.
模組 ID-07 與中繼節點 Base-001 之 ESP-NOW 訊號強度下降至 -68 dBm。|The ESP-NOW signal between module ID-07 and Base-001 has dropped to -68 dBm.
Buck 電路輸出電壓波動幅度 +8.3%，已進行主動調節。|Buck circuit output voltage fluctuated by +8.3%; active regulation was applied.
七橋問題連線驗證成功，模組連接形成閉合歐亞環路，後續巡檢與維護效率已最佳化。|Connection verification succeeded. The modules form a closed route for efficient inspection and maintenance.
水面智慧浮動太陽能發電系統已成功啟動，ESP-NOW 網狀網路初始化完成。|The floating solar power system has started and the ESP-NOW mesh network is initialized.
系統名稱|System Name
管理員 Email|Administrator Email|管理員電子郵件
時區|Time Zone
水面智慧浮動太陽能發電系統 - Macau Reservoir Unit 1|Smart Floating Solar Power System — Macau Reservoir Unit 1|水面智慧浮動太陽能發電系統 — 澳門水庫一號機組
通訊協定|Communication Protocol
中繼 Base MAC 位址|Gateway MAC Address|中繼基站 MAC 位址
ESP32 標準|ESP32 Standard
高速|High Speed
WebSocket 網關位址 (Wi-Fi 模式)|WebSocket Gateway Address (Wi-Fi Mode)
連線 USB Serial|Connect USB Serial
查看 ESP32 韌體|View ESP32 Firmware
輸出電壓 (12V)|Output Voltage (12V)
過壓保護 (OVP)|Overvoltage Protection (OVP)
過溫保護 (OTP)|Overtemperature Protection (OTP)
最大功率點追蹤 MPPT|Maximum Power Point Tracking (MPPT)
Email 通知|Email Notifications|電子郵件通知
預覽 Email|Preview Email
設定 Email 通知 (限管理員)|Configure email notifications (administrators only)
收件人 Email|Recipient Email
Email 主旨|Email Subject
Email 內容|Email Body
Email 通知預覽|Email Notification Preview
複製內容|Copy Content
開啟 Email|Open Email
Email 通知內容已複製|Email notification content copied
請輸入有效的 Email 收件人|Enter a valid email recipient
已開啟 Email 應用程式|Email app opened
此瀏覽器不支援 Web Push 通知|This browser does not support Web Push notifications
瀏覽器已封鎖通知，請在網站設定中重新允許|Notifications are blocked. Re-enable them in site settings.
Web Push 通知已啟用|Web Push notifications enabled
Web Push 通知未啟用|Web Push notifications not enabled
目前沒有未確認通知。|No unacknowledged notifications.
每日摘要報告已準備好，可使用 Email 預覽寄送|Daily summary report is ready. Use Email Preview to send it.
Email 通知尚未啟用|Email notifications are not enabled
即時推播 (Web Push)|Push Notifications|即時推播
每日摘要報告|Daily Summary Report
預覽報告|Preview Report
下載報告|Download Report
運行裝置|Active Devices
警報摘要|Alert Summary
每日摘要報告已下載|Daily summary report downloaded
七橋連線驗證 (每日)|Daily Connection Verification
權限：所有系統功能、控制、通訊與設定|Access: All system features, controls, communications and settings
權限：硬體開關、裝置新增、連線路徑|Access: Hardware controls, new devices and connection paths
權限：即時數據與發電日誌檢視|Access: View live data and generation logs
切換至此帳號|Switch to This Account
水面智慧浮動太陽能發電系統 • 操作控制台|Smart Floating Solar Power System • Management Console
帳號或密碼錯誤，請重新輸入。|Incorrect username or password. Please try again.
請輸入使用者帳號|Enter your username
請輸入密碼|Enter your password
顯示/隱藏密碼|Show/hide password
保持登入狀態 (30 天)|Keep me signed in (30 days)
提示|Notice
點擊檢視使用者資訊與登出|View account details and sign out
點擊檢視使用者資訊|View account details
搜尋系統、裝置ID、關鍵字...|Search systems, device IDs, keywords…
訪客唯讀模式|Guest Read-Only Mode
請先產生蜂窩模組！|Generate the solar array first!
至少啟用 2 個以上的模組！|Enable at least two modules!
歐亞迴路找到！長度|Route found! Nodes:|已找到路徑！節點數：
節點 (巡檢路徑已發送至 ESP-NOW)|(Inspection route sent via ESP-NOW)|（巡檢路徑已發送至 ESP-NOW）
未找到連接所有啟用模組的路徑|No route connects all enabled modules.
全部啟動模組|Enable all modules
全部停止模組|Disable all modules
所有裝置已啟動 (ESP-NOW 指令已廣播)|All devices enabled (ESP-NOW command broadcast)
所有裝置已停止 (ESP-NOW 指令已廣播)|All devices disabled (ESP-NOW command broadcast)
切換模組電源|Toggle module power
啟動 ON|enabled|啟動
停止 OFF|disabled|停止
ESP-NOW 指令已下發|ESP-NOW command sent
現場環境監控開關|Toggle site environment monitoring
現場環境監控已開啟|Site environment monitoring enabled
現場環境監控已關閉|Site environment monitoring disabled
是否中斷實體硬體連線並返回模擬模式？|Disconnect the hardware and return to simulation mode?
已切換回模擬模式|Switched to simulation mode
ESP-NOW 基站連線|ESP-NOW gateway connection
ESP-NOW 串列埠連線|ESP-NOW serial connection
不支援 Web Serial API|Web Serial API Not Supported
您的瀏覽器尚未支援或未啟用|Your browser does not support or has not enabled
• 建議使用電腦端|• Use the desktop version of
或|or
瀏覽器。|browser.
• 若使用手機或 Firefox/Safari，請改用|• On mobile or Firefox/Safari, use
連線方式。|to connect.
• 或點選下方「注入測試」以體驗 ESP-NOW 數據封包解析管線！|• Or select “Inject Test Packet” below to try ESP-NOW packet parsing.
模擬硬體封包注入|Inject Sample Hardware Packet
請在瀏覽器彈出視窗選擇 ESP32 串列埠...|Select the ESP32 serial port in the browser dialog…
成功連線 ESP32 基站|Connected to ESP32 gateway
串列埠連線失敗:|Serial connection failed:
ESP32 串列埠已安全中斷|ESP32 serial connection closed
透過 Wi-Fi 無線連接 ESP32 網關中繼基站 (ESP32 AP 預設 IP: 192.168.4.1)|Connect to the ESP32 gateway over Wi-Fi (default ESP32 access point IP: 192.168.4.1)
連線提示：|Connection Tips:
1. 請先確保電腦/手機 Wi-Fi 已連接至 ESP32 基地台熱點：|1. Connect your computer or phone to the ESP32 Wi-Fi access point:
密碼:|Password:
2. 若 ESP32 與電腦在同一個局域網路，請填入 ESP32 的區域 IP 位址 (例如|2. If ESP32 and your computer are on the same local network, enter its local IP address (for example
連線 Wi-Fi 網關|Connect Wi-Fi Gateway
連線 ESP32 Wi-Fi 網關|Connect ESP32 Wi-Fi Gateway
連線中:|Connecting:
成功連線 ESP32 Wi-Fi 網關！|Connected to ESP32 Wi-Fi gateway!
WebSocket 連線異常|WebSocket connection error
連線錯誤:|Connection error:
面板過溫|Panel overheating:
超標 > 60°C|above limit > 60°C
輸出電壓異常:|Abnormal output voltage:
標準 12.0V|nominal 12.0V
ESP-NOW 基站已應答|ESP-NOW gateway responded
ESP-NOW 遙測告警|ESP-NOW Telemetry Alert
今天|Today
已注入|Injected
真實 ESP-NOW 封包|sample ESP-NOW packet|測試 ESP-NOW 封包
電壓:|Voltage:
溫度:|Temperature:
日誌已清空|Logs cleared
終端日誌已清空|Terminal logs cleared
硬體連線中|Hardware Connected
模擬模式中|Simulation Mode
暫無通訊紀錄。請連線實體 ESP32 或點擊「注入測試」。|No communication logs yet. Connect an ESP32 or select “Inject Test Packet”.
輸入 JSON 指令，例如:|Enter a JSON command, e.g.:
發送|Send
注入測試數據|Inject Test Data
清除日誌|Clear Logs
指令已發送|Command sent
原始碼已同步存於專案|Source code is also in the project’s
資料夾中|folder
支援晶片:|Supported chips:
下載程式碼檔案|Download Source File
複製程式碼|Copy Code
ESP32 / ESP-NOW 韌體程式碼與接線指南|ESP32 / ESP-NOW Firmware & Wiring Guide
韌體程式碼已複製至剪貼簿！|Firmware copied to clipboard!
複製失敗，請手動全選複製|Copy failed. Please select and copy manually.
已下載檔案:|Downloaded file:
修改系統硬體與通訊設定 (限管理員)|Modify hardware and communication settings (administrators only)
儲存系統設定 (限管理員)|Save system settings (administrators only)
系統設定已成功儲存|System settings saved
開啟|Enabled:
已關閉|Disabled:
選項|option
硬體 12V 輸出|12V hardware output
過壓保護 OVP|Overvoltage protection (OVP)
過溫保護 OTP|Overtemperature protection (OTP)
MPPT 最大功率追蹤|Maximum power point tracking (MPPT)
Web Push 即時推播|Push notifications|即時推播
每日七橋連線驗證|Daily connection verification
請輸入關鍵字|Enter a search term
查詢關鍵字：|Search term:
比對命中：|Matches:
筆結果|results
匹配裝置：|Matching devices:
未匹配裝置 ID，已於功能選單搜尋相關結果|No matching device IDs; searched the feature menu for related results.
搜尋結果|Search Results
溫度 62.5°C 超標|Temperature 62.5°C exceeds the limit
已主動調節|Actively regulated
通知中心|Notification Center
已跳轉至 系統設定|Opened system settings
權限不足：|Access denied:
無法執行「|cannot perform “
此操作|this action
操作介面已鎖定 • 請輸入|Console locked • Enter the password for
的密碼解鎖|to unlock
控制台已鎖定|Console locked
已成功切換為|Switched to
身分|account
帳號密碼已成功恢復為系統預設值|Account passwords restored to defaults
請輸入完整的使用者帳號與密碼|Enter both your username and password
驗證身分中...|Verifying…
歡迎回來，|Welcome back,
帳號或密碼不正確，請重新檢查後再試|Incorrect username or password. Check and try again.
已切換使用者，請登入新帳號|Please sign in with the new account
已安全登出系統|Signed out successfully
分鐘|minutes
剛登入|Just signed in
使用者角色:|User Role:
登入 IP:|Login IP:
本次連線:|Current Session:
通訊節點:|Communication Node:
授權清單:|Permissions:
鎖定螢幕|Lock Screen
修改密碼|Change Password
切換使用者帳號|Switch Account
使用者資訊與控制|Account Details & Controls
正在修改帳號|Changing password for
之密碼：|:
請輸入原密碼|Enter your current password
請輸入新密碼 (至少 4 位)|Enter a new password (at least 4 characters)
請再次輸入新密碼|Re-enter your new password
確認修改|Confirm Change
修改帳號密碼|Change Account Password
請填寫所有密碼欄位|Complete all password fields
原密碼輸入不正確|Current password is incorrect
新密碼長度需大於 4 位|New password must contain at least 4 characters|新密碼長度至少需 4 位
兩次輸入的新密碼不相符|New passwords do not match
密碼修改成功，下次請使用新密碼登入|Password changed. Use the new password next time you sign in.
密碼已更新並儲存在此瀏覽器。|Password updated and stored in this browser.
若要把新密碼寫入 HTML 預設值，請下載已更新的單檔 HTML。|To write the new password into the HTML defaults, download the updated single-file HTML.
儲存方式：加鹽雜湊密碼，不包含明文密碼|Storage: salted password hash, no plain-text password included
下載已更新 HTML|Download Updated HTML
密碼已更新|Password Updated
無法在 HTML 中找到此帳號密碼欄位|Could not find this account password field in the HTML.
已產生包含新密碼的 HTML 檔案|Generated an HTML file with the new password.
產生 HTML 檔案失敗|Failed to generate HTML file
輸入密碼切換|Enter Password to Switch
切換至|Switch to
需要輸入此帳號密碼。|requires this account password.
帳號密碼 / Account Password|Account Password
密碼|password|密碼
驗證切換權限|Verify Switch Permission
確認切換|Confirm Switch
請輸入帳號密碼|Enter the account password
密碼輸入不正確，無法切換帳號|Incorrect password. Account switch blocked.
秒前|seconds ago
檢視|View
啟動/停止|Enable/Disable
移除|Remove
發電功率|Power Output
面板溫度|Panel Temperature
韌體版本|Firmware Version
MAC 位址：|MAC Address:
ESP32 晶片：|ESP32 Chip:
Buck 電路：|Buck Circuit:|降壓電路：
LM2596 降壓穩壓 12V / 5A|LM2596 Step-down Regulator 12V / 5A
太陽能板：|Solar Panel:
單晶 18V / 20W (六角蜂巢造型)|Monocrystalline 18V / 20W (Hexagonal)
設定已套用|settings applied
套用設定|Apply Settings
定位|Locate
裝置詳情|Device Details
切換裝置開關|Toggle device power
ESP-NOW 指令已發送|ESP-NOW command sent
狀態已切換|status changed
刪除裝置 (限管理員)|Remove device (administrators only)
確定移除|Remove device
已從管理列表移除|removed from the device list
新裝置座標 (q, r)|New Device Coordinates (q, r)
ESP32 MAC 最後 2 碼|Last 2 Digits of ESP32 MAC
初始狀態|Initial Status
停用|Disabled
啟用|Enabled
確認新增|Add Device
新增六角模組裝置|Add Hexagonal Module
新裝置|New device
已新增成功|added successfully
裝置列表已匯出 CSV|Device list exported to CSV
裝置列表已重新整理|Device list refreshed
已確認：|Acknowledged:
已取消確認：|Acknowledgment removed:
所有警報已確認|All alerts acknowledged
已篩選 INFO 等級通知|Showing information alerts|已篩選一般通知
已篩選 WARNING 等級通知|Showing warnings|已篩選警告通知
已篩選 DANGER 等級通知|Showing danger alerts|已篩選危險通知
已顯示全部警報|Showing all alerts
正常|Normal
儲存資訊|Storage information
已顯示即時資料|Live data displayed
水面智慧浮動太陽能發電系統|Smart Floating Solar Power System
操作控制台|Management Console
清除|Clear
取消|Cancel
關閉|Close
模組|Module
裝置|Device
已啟動 ON|enabled|已啟動
已停止 OFF|disabled|已停止
。|.
，|,
：|:
「|“
」|”
！|!
？|?
Notifications|Notifications|通知
Settings|Settings|設定
Admin User|Admin User|管理員
System Administrator|System Administrator|系統管理員
Administrator|Administrator|管理員
Field Maintenance Engineer|Field Maintenance Engineer|現場維護工程師
Field Maintenance Operator|Field Maintenance Operator|現場維護操作員
Field Engineer|Field Engineer|現場工程師
Public Viewer (Read-Only)|Public Viewer (Read-Only)|一般訪客（唯讀）
Guest Viewer|Guest Viewer|訪客
Operator|Operator|操作員
Guest|Guest|訪客
ADMIN|ADMIN|管理員
OPERATOR|OPERATOR|操作員
GUEST|GUEST|訪客
CONSOLE LOCKED|CONSOLE LOCKED|控制台已鎖定
ESP-NOW 2.0 ENCRYPTED SESSION • MACAU RESERVOIR UNIT 1|ESP-NOW 2.0 ENCRYPTED SESSION • MACAU RESERVOIR UNIT 1|ESP-NOW 2.0 加密連線 • 澳門水庫一號機組
UTC+08:00 Macau Standard Time|UTC+08:00 Macau Standard Time|UTC+08:00 澳門標準時間
Macau Base Relay|Macau Base Relay|澳門基站中繼
Mobile Gateway|Mobile Gateway|行動網關
Guest Network|Guest Network|訪客網絡
Standby (ESP-NOW)|Standby (ESP-NOW)|待機（ESP-NOW）
Standby (Simulation)|Standby (Simulation)|待機（模擬模式）
Simulation Mode|Simulation Mode|模擬模式
Real Hardware Mode (ESP32)|Real Hardware Mode (ESP32)|實體硬體模式（ESP32）
ESP32 Connected|ESP32 Connected|ESP32 已連接
ESP-NOW Active (Live)|ESP-NOW Active (Live)|ESP-NOW 即時連線
ESP-NOW Gateway (Active Stream)|ESP-NOW Gateway (Active Stream)|ESP-NOW 網關（即時數據流）
Active Nodes|Active Nodes|運行節點
ESP-NOW RX|ESP-NOW RX|ESP-NOW 接收
ESP-NOW TX|ESP-NOW TX|ESP-NOW 傳送
Latency|Latency|延遲
pkts|pkts|封包
Load:|Load:|負載：
Capacity:|Capacity:|容量：
In-Use|In-Use|使用中
Idle:|Idle:|待機：
Normal|Normal|正常
Just Now!|Just Now!|剛剛更新
Mon|Mon|週一
Tue|Tue|週二
Wed|Wed|週三
Thu|Thu|週四
Fri|Fri|週五
Sat|Sat|週六
Sun|Sun|週日
ONLINE|ONLINE|在線
OFFLINE|OFFLINE|離線
WARNING|WARNING|警告
DANGER|DANGER|危險
INFO|INFO|資訊
ON|ON|啟動
OFF|OFF|停止
Active|Active|運行中
Device:|Device:|裝置：
Location:|Location:|位置：
Voltage:|Voltage:|電壓：
System:|System:|系統：
Path Verification|Path Verification|路徑驗證
Nodes:|Nodes:|節點：
Edges:|Edges:|連線：
Generation System|Generation System|發電系統
WebSocket URL|WebSocket URL|WebSocket 網址
ESP32-MESH Node|ESP32-MESH Node|ESP32-MESH 節點
Language|Language|語言
ESP32 接收中繼基站韌體 - Base Station Gateway|ESP32 Base Station Gateway Firmware|ESP32 接收中繼基站韌體
ESP32 水面浮動太陽能節點韌體 - Solar Node|ESP32 Floating Solar Node Firmware|ESP32 水面浮動太陽能節點韌體
檔案:|File:
輸出 JSON 給 Web Serial API|Output JSON to the Web Serial API
解析下行指令並轉發 ESP-NOW|Parse downstream commands and forward via ESP-NOW
DeviceID,Coordinate,Status,Voltage,Temperature,Signal,Power,LastReport|DeviceID,Coordinate,Status,Voltage,Temperature,Signal,Power,LastReport|裝置編號,座標,狀態,電壓,溫度,訊號,發電量,最後回報
[SYS] Web Serial port opened successfully at|[SYS] Web Serial port opened successfully at|[系統] Web Serial 串列埠已開啟，傳輸率
[ERR] Serial error:|[ERR] Serial error:|[錯誤] 串列埠錯誤：
[ERR] Read stream error:|[ERR] Read stream error:|[錯誤] 數據流讀取錯誤：
[SYS] USB Serial port disconnected.|[SYS] USB Serial port disconnected.|[系統] USB Serial 串列埠已中斷。
[SYS] Connecting WebSocket to|[SYS] Connecting WebSocket to|[系統] 正在連接 WebSocket：
[SYS] WebSocket connected successfully.|[SYS] WebSocket connected successfully.|[系統] WebSocket 已成功連接。
[ERR] WebSocket error:|[ERR] WebSocket error:|[錯誤] WebSocket 錯誤：
[SYS] WebSocket connection closed.|[SYS] WebSocket connection closed.|[系統] WebSocket 連線已關閉。
[SYS] WebSocket disconnected.|[SYS] WebSocket disconnected.|[系統] WebSocket 已中斷。
Serial Write Err:|Serial Write Err:|串列埠寫入錯誤：
WebSocket Send Err:|WebSocket Send Err:|WebSocket 傳送錯誤：
[ACK] Command sent to target node|[ACK] Command sent to target node|[確認] 指令已發送至目標節點
Success:|Success:|成功：
`;

    (() => {
      const storageKey = 'hex_solar_language';
      const supported = ['en', 'zh-TW'];
      let saved;
      try { saved = localStorage.getItem(storageKey); } catch (_) { /* Storage may be disabled. */ }
      const requested = new URLSearchParams(location.search).get('lang');
      let language = supported.includes(requested) ? requested : supported.includes(saved) ? saved : 'zh-TW';
      const catalog = new Map(CONSOLE_TRANSLATIONS.split('\n').filter(Boolean).map(row => {
        const [source, en, zh = source] = row.split('|');
        return [source, { en, 'zh-TW': zh }];
      }));
      const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match once, longest phrase first, so translated output is never translated again.
      const pattern = new RegExp([...catalog.keys()].sort((a, b) => b.length - a.length).map(source => {
        const phrase = source.split(/\s+/).map(escapeRegex).join('\\s+');
        const left = /^[A-Za-z]/.test(source) ? '(?<![A-Za-z0-9_@.-])' : '';
        const right = /[A-Za-z]$/.test(source) ? '(?![A-Za-z0-9_@.-])' : '';
        return left + phrase + right;
      }).join('|'), 'g');
      const normalizedCatalog = new Map([...catalog].map(([key, value]) => [key.replace(/\s+/g, ' '), value]));
      function translate(source) {
        return String(source).replace(pattern, match => normalizedCatalog.get(match.replace(/\s+/g, ' '))[language]);
      }
      function firmware(source, tab) {
        if (tab === 'guide') return language === 'zh-TW' ? source : `# ESP32 & ESP-NOW Wiring and Flashing Guide
1. Install ESP32 board support (version 2.0.x / 3.0.x) in Arduino IDE.
2. Connect the gateway ESP32 to your computer via USB, open esp32_base_station_gateway.ino and flash it.
3. Connect each floating solar module ESP32 via USB, set MODULE_ID to its module number and flash it.
4. Wiring:
   - 18V solar panel -> LM2596 buck regulator -> 12V output
   - Voltage sensing: 100kΩ / 10kΩ divider -> GPIO 34
   - 12V output switch: GPIO 26 -> N-MOSFET gate
5. Open this console and select “Connect ESP32 (USB Serial)” to monitor live data.`;
        // Only comments are localized. Firmware identifiers and packet bytes are code.
        return source.replace(/\/\/[^\r\n]*/g, comment => translate(comment));
      }

      // Remember source text independently of its rendered language. Never recreate the
      // page: event listeners, entered values, focus and hardware connections survive.
      const textRecords = new WeakMap();
      const attributeRecords = new WeakMap();
      const ignored = 'script, style, code, [data-no-i18n], .language-switch';
      function renderText(node) {
        if (!node.parentElement || node.parentElement.closest(ignored)) return;
        let record = textRecords.get(node);
        if (!record || node.data !== record.rendered) record = { source: node.data };
        record.rendered = node.parentElement.id === 'firmwareCodeView'
          ? firmware(record.source, currentFirmwareTab) : translate(record.source);
        if (node.data !== record.rendered) node.data = record.rendered;
        textRecords.set(node, record);
      }
      function renderAttributes(element) {
        if (element.closest(ignored)) return;
        let records = attributeRecords.get(element);
        if (!records) { records = {}; attributeRecords.set(element, records); }
        for (const attribute of ['title', 'placeholder', 'aria-label']) {
          if (!element.hasAttribute(attribute)) continue;
          const value = element.getAttribute(attribute);
          let record = records[attribute];
          if (!record || value !== record.rendered) record = { source: value };
          record.rendered = translate(record.source);
          if (value !== record.rendered) element.setAttribute(attribute, record.rendered);
          records[attribute] = record;
        }
      }
      function render(root) {
        if (root.nodeType === Node.TEXT_NODE) { renderText(root); return; }
        if (root.nodeType === Node.ELEMENT_NODE) renderAttributes(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.nodeType === Node.TEXT_NODE) renderText(walker.currentNode);
          else renderAttributes(walker.currentNode);
        }
      }
      const observer = new MutationObserver(changes => {
        // Ignore our own writes by disconnecting while rendering; no feedback loop.
        observer.disconnect();
        for (const change of changes) {
          if (change.type === 'childList') change.addedNodes.forEach(render);
          else if (change.type === 'characterData') renderText(change.target);
          else renderAttributes(change.target);
        }
        observe();
      });
      function observe() {
        observer.observe(document.documentElement, {
          subtree: true, childList: true, characterData: true, attributes: true,
          attributeFilter: ['title', 'placeholder', 'aria-label']
        });
      }
      function refresh() {
        observer.disconnect();
        document.documentElement.lang = language;
        render(document.documentElement);
        document.querySelectorAll('[data-language-select]').forEach(select => {
          select.value = language;
          select.setAttribute('aria-label', translate('Language'));
        });
        document.querySelectorAll('[data-language-label]').forEach(label => { label.textContent = translate('Language'); });
        // Translate only untouched default settings, never user-entered values.
        document.querySelectorAll('[data-localized-default]').forEach(input => {
          const previous = input.dataset.localizedValue || input.defaultValue;
          if (input.value === previous) {
            input.value = translate(input.defaultValue);
            input.dataset.localizedValue = input.value;
          }
        });
        if (typeof drawAll === 'function') drawAll();
        observe();
      }
      function setLanguage(value) {
        if (!supported.includes(value)) return;
        language = value;
        try { localStorage.setItem(storageKey, language); } catch (_) { /* Keep the current session usable. */ }
        // Keep an explicitly shared language URL consistent with subsequent switches.
        try {
          const url = new URL(location.href);
          if (url.searchParams.has('lang')) {
            url.searchParams.set('lang', language);
            history.replaceState(null, '', url);
          }
        } catch (_) { /* file:// may not allow history updates. */ }
        refresh();
      }
      window.consoleI18n = { translate, firmware, setLanguage, refresh, get language() { return language; } };
      document.querySelectorAll('[data-language-select]').forEach(select => {
        select.addEventListener('change', () => setLanguage(select.value));
      });
      refresh();
    })();