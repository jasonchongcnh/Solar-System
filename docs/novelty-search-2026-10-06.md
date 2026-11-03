# 六角形浮動太陽能系統：初步查新與檢索策略

查閱及補核日期：2026 年 10 月 6 日。查新範圍依申報人確認，涵蓋六角形浮動太陽能模組、六路霍爾接合感測、ESP32／ESP-NOW、自製 PCB 及網頁管理平台，重點為整合設計。

本文件是可公開存取資料的初步文獻比對及後續資料庫檢索方案。本次未取得五個指定資料庫的完整原生檢索結果，不能當作已完成五庫全面查新的證明。以下區分資料庫公開索引、出版者或大學原始資料，以及補充專利全文鏡像；不填寫無法核驗的命中篇數。工具不能開啟頁面，或公開搜尋未返回相關結果，均不表示資料庫沒有相關文獻。

目前未取得作品的完成日期或首次公開日期。本次以截至上述查閱日期可核驗的公開資料作技術比較，不直接判定每篇資料相對於作品完成時的先後關係。

## 一、查新點的界定

本項目以六角形浮動光伏模組為應用載體，將六個方向的磁性接合狀態感測、ESP32 節點資料處理、ESP-NOW 節點至閘道傳輸，以及網頁管理介面整合，並以自製 PCB 作為電路整合的查新對象。比對重點為各模組之間的功能配合及具體實現，不宜僅將「太陽能發電、ESP32、PCB」三個名稱的共同出現當作創新依據。

依現有專案說明，D0–D5 對應六路數位霍爾輸入，其資料代表磁場存在／不存在。此資訊可供接合狀態判讀，但不直接證明機械鎖定、電氣導通、相鄰模組身分或完整陣列拓撲。D6–D8 的實際硬體配置尚未核實，不列為已驗證的創新功能。PCB 原理圖與佈局尚未提供，本次只能比較功能整合，不能認定某種 PCB 電路或佈局具有新穎性。現階段亦不將未實測的發電效率、傳輸距離、功耗或電壓電流量測精度寫成作品指標。

## 二、指定資料庫的實際查閱範圍

**中國學術期刊網／中國知網（CNKI）。** 本次未能正常進入主站／進階檢索介面取得庫內結果，但取得 CNKI 期刊公開頁的搜尋索引紀錄，核對到《基于边缘智能的自适应农业物联网系统》的題名、作者、卷期頁碼及摘要。這屬公開索引核驗，不等同完成 CNKI 全庫主題檢索。[CNKI 期刊紀錄](https://wgzg.cbpt.cnki.net/portal/journal/portal/client/paper/880793fc66b78d35b7a981f7a664b831)

**萬方資料資源系統。** 本次未能從檢索入口取得可重現的庫內結果；透過萬方公開文章紀錄及期刊目錄的搜尋索引，取得浮動光伏波浪載荷與智能氣候預警兩項文獻，並用出版者頁面交叉核對後者。此為公開紀錄及出版者資料核驗，沒有原生檢索命中數。[萬方文章紀錄](https://d.wanfangdata.com.cn/periodical/tynxb202101001)、[萬方《南方能源建設》2025 年第 1 期目錄](https://sns.wanfangdata.com.cn/sns/perio/nfnyjs/?isSync=1&issueNum=01&page=1&publishYear=2025&tabId=article)

**中國專利資訊網。** 國家知識產權局知識產權檢索諮詢中心的歷史公告將「中國專利信息網」對應至 patent.com.cn。本次舊入口無法正常存取，因此改以 Google Patents 的中國專利全文鏡像補充技術比對，不能寫成在指定網站完成檢索。另可透過國家知識產權局的專利檢索及分析入口補查；中國專利信息網與 CNIPR／中國知識產權網不應混稱。[官方歷史公告](https://www.ipscc.org.cn/web/c_0000000400100001/d_195239.html)、[國家知識產權局檢索入口](https://pss-system.cponline.cnipa.gov.cn/conventionalSearch)

**維普科技期刊文摘索引。** 本次 qikan.cqvip.com 入口未正常返回可檢索頁面；cqvip.com 的《海洋工程》期刊目錄公開搜尋索引列出浮動光伏連接方式研究，另以主辦單位南京水利科學研究院的 2026 年第 4 期摘要交叉核對。由於目錄直接開啟時與搜尋索引顯示的期次不同，本文件以主辦方資料確認題名與期次，不據此聲稱完成原文摘庫完整檢索。[維普期刊目錄](https://www.cqvip.com/journal/90248X/90248X)、[主辦方當期摘要](https://www.nhri.cn/xsjl/art/2026/art_0cb07d2e87204da38876729f01712df6.html)

**PQDD-B 博碩士論文文摘庫。** 使用者提供的舊 UMI gateway 在本次工具中無法存取，亦未取得該子庫原生搜尋結果。已核驗一筆 ProQuest 官方公開索引紀錄，並以學位授予大學的論文儲存庫核對。這不代表已確認該論文屬於歷史 PQDD-B 的特定收錄範圍；後續須經學校圖書館確認目前訂購的 ProQuest 學位論文產品及涵蓋範圍。[原指定入口](http://wwwlib.global.umi.com/dissertations/gateway)、[ProQuest 論文紀錄](https://www.proquest.com/docview/2539850879/abstract/39798DAB5A824A1FPQ/1)

## 三、相關文獻與技術比對

**1. 太陽能供電與 ESP32 感測節點。** 程利、胡智、李青松：《基于边缘智能的自适应农业物联网系统》，《武汉工程职业技术学院学报》，2026，38(1)：41–46，出版日期 2026 年 3 月 15 日。CNKI 期刊頁公開摘要記載 ESP32 與 TinyML、太陽能及超級電容供電、休眠與按需喚醒。它說明太陽能供電與 ESP32 節點結合已有研究，但應用為農業環境監測；已讀摘要未披露本作品的六向接合感測整合。[CNKI 期刊頁](https://wgzg.cbpt.cnki.net/portal/journal/portal/client/paper/880793fc66b78d35b7a981f7a664b831)

**2. 浮動光伏與智能監測整合。** 周程晟、方世东：《漂浮式海上光伏智能气候预警平台的实践与研究》，《南方能源建设》，2025，12(1)：75–82，DOI：10.16516/j.ceec.2023-277。萬方刊目及出版者文章頁可相互核對；文章把浮動海上光伏與氣象監測、預警和平台管理結合。因此，僅稱「浮動光伏加入智能監控」不足以界定作品特色；應進一步比對監測對象與資料流程，尤其是本作品的模組邊緣接合狀態。[出版者文章頁](https://www.energychina.press/article/cstr/32391.14.j.ceec.2023-277)

**3. 浮動光伏連接方式。** 郑灿、范永春、范少涛、王洪庆、任灏：《基于时域方法的漂浮式光伏平台连接方式对比与优化》，《海洋工程》，2026 年第 4 期，17–33 頁。維普公開目錄索引及期刊主辦方摘要顯示，研究比較纜繩配防撞橡膠、支撐彈簧及剛性連接三種結構。其重點為波浪下的力學響應，與六路霍爾狀態回報的功能不同；不能因兩者都提到「連接」便視為完全相同。[維普期刊目錄](https://www.cqvip.com/journal/90248X/90248X)、[主辦方摘要](https://www.nhri.cn/xsjl/art/2026/art_0cb07d2e87204da38876729f01712df6.html)

**4. 浮動光伏工程背景。** 郭军、陈作钢、肖福勤、王玉琨、袁露：《光伏电站漂浮方阵波浪载荷数值分析研究》，《太阳能学报》，2021，42(1)：1–6，DOI：10.19912/j.0254-0096.tynxb.2018-0695。萬方公開紀錄摘要介紹漂浮方陣的波浪荷載分析，可作結構應用背景；它與本作品的電子感測及通訊整合並非相同研究重點。[萬方紀錄](https://d.wanfangdata.com.cn/periodical/tynxb202101001)

**5. 六角排列的模組化浮動太陽能結構。** 上海交通大學：《一种海上太阳能装置》，中國專利公開號 CN115140260A，公開日 2022 年 10 月 4 日。已查閱的專利全文鏡像披露三角形太陽能單元、六邊形組合及浮動／鉸接結構。需要區分其「三角形單元組成六角形」與本作品「六角形單元」；不能只憑六角外形認定相同，也不能把六角排列本身作為首創依據。[專利全文鏡像](https://patents.google.com/patent/CN115140260A/zh)

**6. 太陽能、ESP32 及控制電路。** 桂林電子科技大學：《一种小型多能源耦合优化与利用管理系统》，中國專利公開號 CN115891686A，公開日 2023 年 4 月 4 日。說明書披露太陽能輸入、ESP32-WROOM-32D 控制、功率採集及 Wi-Fi 資料傳輸。它構成能源與 ESP32 控制電路整合的相關技術對照；本次未核實與作品相同的 PCB 佈局，不作此推論。[專利全文鏡像](https://patents.google.com/patent/CN115891686A/zh)

**7. 光伏、ESP32、PCB 與 ESP-NOW 的部分組合。** Darwin-Alexander Angamarca-Avendaño、Carlos Flores-Vázquez、Juan-Carlos Cobos-Torres：*A Photovoltaic and Wind-Powered Electric Vehicle with a Charge Equalizer*，Energies，2024，17(18)：4665，DOI：10.3390/en17184665，出版日期 2024 年 9 月 19 日。出版者全文記載控制／功率 PCB、ESP32、ESP-NOW 及物聯網資料傳輸。其應用為光伏與風能電動車及電池管理，與浮動模組接合監測不同，但足以說明僅以這幾項元件或協定的共同使用作為創新點過於寬泛。此為指定五庫之外的出版者補充資料。[出版者全文](https://www.mdpi.com/1996-1073/17/18/4665)

**8. 浮動光伏學位論文。** Koami Soulemane Hayibo：*Quantifying the Value of Foam-Based Flexible Floating Solar Photovoltaic Systems*，Michigan Technological University，碩士論文，2021，DOI：10.37099/mtu.dc.etdr/1176；ProQuest document ID：2539850879。ProQuest 公開索引與校方紀錄核對一致，研究泡棉承載柔性浮動光伏及其效益。已讀摘要未披露本作品的六向接合感測整合；摘要未提及不等同全文不存在。[ProQuest 紀錄](https://www.proquest.com/docview/2539850879/abstract/39798DAB5A824A1FPQ/1)、[大學原始紀錄](https://digitalcommons.mtu.edu/etdr/1176/)

**9. 霍爾感測磁性模組組裝狀態。** Zoltán Nagy 等：*Morphology detection for magnetically self-assembled modular robots*，IEEE/RSJ IROS，2009，5281–5286，DOI：10.1109/IROS.2009.5354764。大學公開研究紀錄摘要記載利用霍爾感測判斷磁性模組組裝狀態。它不是太陽能系統，但說明「霍爾感測磁性接合」本身已有研究；作品仍須說明六向感測如何配合浮動結構及通訊管理。此為指定五庫之外的補充資料。[Groningen 大學紀錄](https://research.rug.nl/en/publications/morphology-detection-for-magnetically-self-assembled-modular-robo/)、[Eindhoven 大學紀錄](https://research.tue.nl/en/publications/morphology-detection-for-magnetically-self-assembled-modular-robo)

**10. 六邊形浮水模組與磁性邊緣連接。** 《一种遮盖装置和其构成方法》，CN113383126A 的公開日為 2021 年 9 月 10 日；CN113383126B 的授權公告日為 2023 年 3 月 31 日。已讀 B 版說明書實施例披露六邊形浮水遮蓋板及沿邊緣配置的磁性體，用途為減少液體蒸發。因此，「六邊形、浮水、磁性接合」已有相關結構，不能籠統當作作品首創。它未構成本次所述完整光伏感測系統。此專利另有更早同族；本次沒有核實整個同族的最早公開日，不能將上述 A 版日期稱為同族首次公開日。[A 版紀錄](https://patents.google.com/patent/CN113383126A/zh)、[B 版全文鏡像](https://patents.google.com/patent/CN113383126B/zh)

**11. 六邊形太陽能照明模組與磁性組裝。** 《便携式太阳能智慧光源模块化组装结构》，CN209250576U，實用新型授權公告日為 2019 年 8 月 13 日。公開全文鏡像的索引內容披露六邊形太陽能薄膜電池、LED 及轉接模組、磁性插接與 Arduino Nano 控制。其用途為便攜照明，未見浮動結構或本作品的六路霍爾及 ESP-NOW 整合。本次未核實個人申請人姓名，因此不將發明人姓名直接填為申請人。[專利全文鏡像](https://patents.google.com/patent/CN209250576U/zh)

## 四、檢索詞

中文檢索以簡體字詞為主，並以繁體異形詞補查。太陽能主題使用「太阳能发电、光伏发电、光伏、太阳能电池、太阳能供電」；浮動結構使用「水面光伏、漂浮式光伏、浮动式光伏、水上光伏、海上光伏」；幾何與組裝使用「六边形、六角形、蜂窝、模块化、拼接、浮体、连接」；感測使用「霍尔传感器、霍尔开关、磁感应、磁性连接、接合检测、连接状态、脱离检测」；控制與通訊使用「ESP32、ESP-32、ESP32-C3、ESP-NOW、单片机、微控制器、无线传感器网络」；電路使用「PCB、印制电路板、印刷电路板、控制电路、传感器接口」；管理使用「网页监控、远程监测、数据采集、网关、物联网、WebSocket、Web Serial」。

英文檢索詞使用 photovoltaic、solar power、solar energy、solar cell、solar-powered、floating photovoltaic、floating solar、floatovoltaic、hexagonal、honeycomb、modular、floating platform、Hall sensor、Hall effect sensor、Hall switch、magnetic coupling、magnetic connector、connection detection、docking、ESP32、ESP-32、ESP32-C3、ESP-NOW、microcontroller、wireless sensor network、PCB、printed circuit board、control circuit、web monitoring、remote monitoring、telemetry、gateway、Internet of Things、WebSocket 及 Web Serial。

## 五、檢索策略與可重現邏輯式

下列是建議於各資料庫進階搜尋執行的邏輯式，尚未取得這些式子的五庫原生執行結果。AND 表示不同概念相交，OR 表示同義詞擴展；實際輸入應依平台選擇欄位及邏輯選單，不假定所有資料庫支援相同欄位代碼或整段語法。以下代號只是本文件的概念集合，使用時須展開成詞組。

```text
A = (太阳能发电 OR 光伏 OR 太阳能供電 OR photovoltaic OR "solar power")
B = (ESP32 OR "ESP-32" OR "ESP32-C3" OR "ESP-NOW")
C = (PCB OR 印制电路板 OR 印刷电路板 OR 控制电路 OR "printed circuit board")
D = (水面光伏 OR 漂浮式光伏 OR 浮动式光伏 OR "floating photovoltaic" OR "floating solar" OR floatovoltaic)
E = (六边形 OR 六角形 OR 蜂窝 OR 模块化 OR 拼接 OR hexagonal OR honeycomb OR modular)
F = (霍尔传感器 OR 霍尔开关 OR 磁感应 OR 接合检测 OR "Hall sensor" OR "Hall effect sensor" OR "Hall switch")
G = (网页监控 OR 远程监测 OR 数据采集 OR 网关 OR "web monitoring" OR "remote monitoring" OR telemetry OR gateway)
H = (磁性连接 OR 磁性接口 OR 连接状态 OR 脱离检测 OR "magnetic coupling" OR "magnetic connector" OR "connection detection" OR docking)
```

首先進行分項檢索，使用 A AND B、A AND C、A AND B AND C、D AND E、D AND G，分別了解太陽能與微控制器、電路整合、浮動模組結構及監控平台的相關技術。再進行功能交叉檢索，使用 D AND F、D AND H、E AND F AND H、A AND B AND F，並以 B AND F AND H 查找非光伏領域的可比接合感測技術。最後以 A AND B AND C AND (D OR E) AND F 作較精確的整合組合核查；不能只執行最後一條，因過多交集會漏掉摘要中未寫明晶片、PCB 或感測器型號的文獻。

```text
中文整合例式：
(光伏 OR 太阳能发电)
AND (ESP32 OR ESP-32 OR ESP-NOW)
AND (PCB OR 印制电路板 OR 控制电路)

中文接合例式：
(漂浮式光伏 OR 水面光伏 OR 浮动式光伏)
AND (霍尔 OR 磁感应 OR 磁性连接 OR 接合检测)

英文整合例式：
(photovoltaic OR "solar power")
AND (ESP32 OR "ESP-32" OR "ESP-NOW")
AND (PCB OR "printed circuit board" OR "control circuit")

英文跨領域感測例式：
(modular OR hexagonal OR honeycomb)
AND ("Hall sensor" OR "Hall effect sensor" OR "Hall switch")
AND ("magnetic coupling" OR "connection detection" OR docking)
```

在 CNKI、萬方及維普，宜先於主題、篇名、關鍵詞及摘要欄位執行上述分組組合；如平台提供全文欄位，再補查 ESP32、ESP-NOW 及 PCB 等可能只在實作部分出現的詞。優先中文，另以英文詞及已知篇名／DOI 查核。第一輪不限定核心期刊，也不只選「可下載全文」，以免漏失已收錄但全文權限受限的文獻。

專利檢索先查名稱及摘要，再查權利要求和說明書全文；晶片型號可能只在實施例出現，因此須保留較廣的「微控制器、无线通信、控制电路」補查。對已找到的相關專利，追查其分類號、引用及同族，再評估是否擴展到境外同族。按公開號及同族去重，分別記錄申請日、公開日與授權公告日，不把授權日當作首次公開日。六角形單元、六角形排列及六邊形電路板須分開判讀。

學位論文檢索應先由圖書館確認所訂購的是歷史 PQDD-B、PQDT 或其他 ProQuest 產品及其涵蓋範圍，再於題名、摘要、主題或「全文以外」欄位按英文分組搜尋。可先用 floating photovoltaic／floating solar 配合 modular、monitoring，再用 photovoltaic 配合 ESP32、PCB；如有全文權限，補查 ESP-NOW、Hall sensor 及 printed circuit board。各 ProQuest 產品的欄位代碼未必相同，因此此處不提供通用 TI／SU／NOFT 指令冒充各平台均可直接執行的語法。[ProQuest 進階搜尋指南（校方存放之原指南）](https://lib.itb.ac.id/wp-content/uploads/sites/163/2021/06/PQP_Advanced_Search_Quick_Guide_EN.pdf)

檢索年限原則上自各庫收錄起始至 2026 年 10 月 6 日，不以近期年份作唯一篩選條件。中文與英文並行；對重要非中文／英文紀錄，保留其英文摘要及可核驗書目。每次庫內執行應保存檢索日期、資料庫與子庫名稱、欄位、完整檢索式、限制條件、命中數及匯出紀錄；在取得真實結果前，命中數欄位標記「待執行」，不能填 0。

比對時須區分「霍爾電流量測」與「霍爾磁性接合偵測」、「太陽能為節點供電」與「監測光伏發電系統」，也須區分「PCB 製作」與「具體的新電路或結構」。不宜先用 NOT 排除電流感測文獻，因同一研究可能同時包含兩種用途；應以摘要及全文人工判讀。對沒有全文的紀錄，只能寫「已讀摘要未披露」，不能推論全文不存在某項功能。

## 六、本次實際執行的公開網頁補核摘錄

本次已嘗試存取 CNKI、萬方、維普、patent.com.cn 及使用者提供的 PQDD 舊入口，並執行資料庫站點／篇名的公開索引搜尋、出版者頁與大學原始紀錄核對，以及專利全文鏡像閱讀。以下摘錄本次使用的網頁查詢字串，屬公開搜尋引擎查詢，並非五個資料庫內部的進階檢索式，也不是完整歷程或命中數統計。

```text
site.wgzg.cbpt.cnki.net "基于边缘智能的自适应农业物联网系统"
site.energychina.press "漂浮式海上光伏智能气候预警平台的实践与研究"
site.nhri.cn "基于时域方法的漂浮式光伏平台连接方式对比与优化"
site.cqvip.com/journal/90248X/90248X "基于时域方法"
site.sns.wanfangdata.com.cn "漂浮式海上光伏智能气候预警平台"
"A Photovoltaic and Wind-Powered Electric Vehicle with a Charge Equalizer"
site.proquest.com/docview/2539850879 "Quantifying"
"floating photovoltaic" "ESP32" "Hall"
"浮动" "光伏" "霍尔" "ESP32"
"六边形" "光伏" "磁性" "连接"
"floating solar" "ESP-NOW" "PCB"
```

## 七、可直接填入申報表的「檢索詞及檢索策略」

本項目以「太陽能發電、光伏發電、ESP32、ESP-NOW、PCB、印製電路板」為核心檢索詞，並依整合設計特徵，擴展「漂浮式光伏、水面光伏、六角形、六邊形、蜂窩式、模組化拼接、霍爾感測器、磁性接合、連接狀態偵測、無線感測網路、閘道、網頁監控及遠端監測」等詞。英文檢索詞包括 photovoltaic、solar power、floating photovoltaic、floating solar、hexagonal、modular、Hall sensor、magnetic coupling、connection detection、ESP32、ESP-NOW、printed circuit board、gateway、web monitoring 及 remote monitoring；中文檢索同時考慮簡繁體及同義詞。

檢索擬涵蓋中國學術期刊網、萬方資料資源系統、中國專利資訊網、維普科技期刊文摘索引及 PQDD-B／由圖書館確認的現行 ProQuest 學位論文資源，年限自各庫收錄起始至 2026 年 10 月 6 日。採用同義詞 OR 擴展、不同技術概念 AND 交叉的方式，先分別檢索「太陽能與 ESP32」「太陽能與 PCB」「浮動光伏與模組拼接」，再檢索「霍爾感測與磁性接合」「浮動光伏與網頁監控」，最後核查多項技術的完整組合。一般文獻先查題名、摘要、關鍵詞及主題，再以全文補查晶片與電路細節；專利擴及權利要求與說明書。對相關文獻進行引用追蹤、重複紀錄剔除及技術特徵比對，重點考察六向接合感測、電路整合、節點通訊與網頁管理之間的配合方式。

本次已完成可公開取得之資料庫索引、出版者資料、大學論文紀錄與專利全文鏡像的初步核對；尚待透過機構權限完成上述資料庫的原生檢索及完整結果匯出，因此不填列未經核實的命中數，也不將公開網頁搜尋結果視為完整查新結論。

## 八、初步比較結論

已核驗資料表明，浮動光伏、六角排列、浮水模組磁性連接、太陽能與 ESP32／PCB 的結合、ESP-NOW 資料傳輸，以及以霍爾感測器判斷磁性模組組裝狀態，均已有相關公開研究或專利記載。因此，本作品應將特色集中於「六角形浮動單元的六向磁性接合狀態，如何經由自製電路、ESP32／ESP-NOW 節點及網頁平台協同呈現」的具體整合，而非單項元件的採用。

在本次已核驗資料中，尚未確認有同一文獻完整披露作品所述全部組合；此結果受到資料庫存取、全文取得及作品硬體資料完整度的限制，不能據此認定國內外首創、沒有相同技術，或已通過正式查新。下一步需要用完整 PCB／機構資料細化技術特徵，完成機構帳號下的庫內檢索，再就最接近文獻逐項比較。
