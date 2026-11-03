import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const now = new Date();
const timeZone = process.env.REPORT_TIMEZONE || 'Asia/Hong_Kong';
const locale = process.env.REPORT_LANGUAGE === 'en' ? 'en-US' : 'zh-HK';
const reportDate = new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(now);
const reportTime = new Intl.DateTimeFormat(locale, {
  timeZone,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
}).format(now);

const systemName = process.env.SYSTEM_NAME || '水面智慧浮動太陽能發電系統';
const dashboardUrl = process.env.DASHBOARD_URL || '';
const language = process.env.REPORT_LANGUAGE || 'zh-TW';

async function loadTelemetry() {
  const telemetryPath = process.env.TELEMETRY_FILE || path.join('data', 'telemetry-sample.json');
  try {
    const raw = await readFile(telemetryPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Telemetry file not available (${telemetryPath}); using environment/default values.`);
    return {};
  }
}

function metric(telemetry, key, envName, fallback) {
  return String(process.env[envName] ?? telemetry[key] ?? fallback);
}

const telemetry = await loadTelemetry();
const sample = {
  activeModules: metric(telemetry, 'activeModules', 'ACTIVE_MODULES', '6'),
  idleModules: metric(telemetry, 'idleModules', 'IDLE_MODULES', '1'),
  offlineModules: metric(telemetry, 'offlineModules', 'OFFLINE_MODULES', '1'),
  currentOutputKw: metric(telemetry, 'currentOutputKw', 'CURRENT_OUTPUT_KW', '43.2'),
  todayGenerationKwh: metric(telemetry, 'todayGenerationKwh', 'TODAY_GENERATION_KWH', '87.6'),
  batteryPercent: metric(telemetry, 'batteryPercent', 'BATTERY_PERCENT', '68'),
  waterSavedLiters: metric(telemetry, 'waterSavedLiters', 'WATER_SAVED_LITERS', '12480'),
  alertCount: metric(telemetry, 'alertCount', 'ALERT_COUNT', '1')
};

function buildZhReport() {
  return [
    `${systemName} - 每日摘要報告`,
    '',
    `日期：${reportDate}`,
    `產生時間：${reportTime}`,
    `時區：${timeZone}`,
    '',
    '系統概況',
    `- 運作中模組：${sample.activeModules}`,
    `- 待機模組：${sample.idleModules}`,
    `- 離線模組：${sample.offlineModules}`,
    `- 目前輸出：${sample.currentOutputKw} kW`,
    '',
    '能源與環境',
    `- 今日發電量：${sample.todayGenerationKwh} kWh`,
    `- 儲能電量：${sample.batteryPercent}%`,
    `- 估計節省蒸發水量：${sample.waterSavedLiters} L`,
    '',
    '警示',
    `- 未處理警示：${sample.alertCount}`,
    '',
    '建議',
    Number(sample.alertCount) > 0
      ? '- 請先檢查未處理警示，並確認離線模組通訊狀態。'
      : '- 系統狀態穩定，建議維持例行巡檢與清潔排程。',
    dashboardUrl ? '' : null,
    dashboardUrl ? `管理控制台：${dashboardUrl}` : null
  ].filter(line => line !== null).join('\n');
}

function buildEnReport() {
  return [
    `${systemName} - Daily Summary Report`,
    '',
    `Date: ${reportDate}`,
    `Generated at: ${reportTime}`,
    `Time zone: ${timeZone}`,
    '',
    'System Overview',
    `- Active modules: ${sample.activeModules}`,
    `- Idle modules: ${sample.idleModules}`,
    `- Offline modules: ${sample.offlineModules}`,
    `- Current output: ${sample.currentOutputKw} kW`,
    '',
    'Energy and Environment',
    `- Today generation: ${sample.todayGenerationKwh} kWh`,
    `- Battery level: ${sample.batteryPercent}%`,
    `- Estimated water evaporation saved: ${sample.waterSavedLiters} L`,
    '',
    'Alerts',
    `- Open alerts: ${sample.alertCount}`,
    '',
    'Recommendation',
    Number(sample.alertCount) > 0
      ? '- Review open alerts first and verify communication for offline modules.'
      : '- System status is stable. Continue routine inspection and cleaning.',
    dashboardUrl ? '' : null,
    dashboardUrl ? `Management console: ${dashboardUrl}` : null
  ].filter(line => line !== null).join('\n');
}

const report = language === 'en' ? buildEnReport() : buildZhReport();
const subject = language === 'en'
  ? `${systemName} Daily Summary - ${reportDate}`
  : `${systemName} 每日摘要報告 - ${reportDate}`;

await mkdir('reports', { recursive: true });
await mkdir('tmp', { recursive: true });

const reportPath = path.join('reports', `daily-summary-${reportDate}.txt`);
await writeFile(reportPath, report, 'utf8');
await writeFile(path.join('tmp', 'daily-email-subject.txt'), subject, 'utf8');
await writeFile(path.join('tmp', 'daily-email-body.txt'), report, 'utf8');

console.log(`REPORT_PATH=${reportPath}`);
console.log(`EMAIL_SUBJECT=${subject}`);
