/**
 * OpenTracker 统计仪表板前端脚本
 */

// API基础URL - 替换为您的Cloudflare Worker URL
const API_BASE_URL = 'https://your-worker-url.workers.dev';

// 图表实例
let usersChart = null;
let connectionsChart = null;
let tcpChart = null;
let udpChart = null;
// 详细统计图表
let torrentsDetailChart = null;
let peersDetailChart = null;
let seedsDetailChart = null;
let completedDetailChart = null;

// 当前时间范围
let currentTimeRange = '1h';

// 当前页面
let currentPage = 'dashboard';

// DOM元素加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 设置Chart.js全局默认值
  Chart.defaults.color = '#a6adba';
  Chart.defaults.borderColor = 'rgba(166, 173, 186, 0.1)';
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  
  // 添加画布背景插件
  const bgPlugin = {
    id: 'customCanvasBackgroundColor',
    beforeDraw: (chart, args, options) => {
      const {ctx} = chart;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = options.color || '#ffffff';
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    }
  };
  
  // 全局注册插件
  Chart.register(bgPlugin);
  
  // 初始化主题
  initTheme();
  
  // 初始化时间范围选择器
  initTimeRangeSelector();
  
  // 初始化页面导航
  initPageNavigation();
  
  // 初始化刷新存储按钮
  initRefreshStorageButton();
  
  // 加载初始数据 - 确保指定时间范围
  loadStats(currentTimeRange);
  
  // 加载存储使用情况
  loadStorageInfo();
});

/**
 * 初始化页面导航
 */
function initPageNavigation() {
  const pageNavLinks = document.querySelectorAll('.page-nav');
  
  // 设置初始活动页面
  setActivePage('dashboard');
  
  // 添加导航点击事件
  pageNavLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetPage = link.dataset.page;
      setActivePage(targetPage);
    });
  });
}

/**
 * 设置活动页面
 * @param {string} pageName - 页面名称
 */
function setActivePage(pageName) {
  // 更新当前页面
  currentPage = pageName;
  
  // 更新导航链接状态
  const pageNavLinks = document.querySelectorAll('.page-nav');
  pageNavLinks.forEach(link => {
    if (link.dataset.page === pageName) {
      link.classList.add('btn-active');
    } else {
      link.classList.remove('btn-active');
    }
  });
  
  // 显示/隐藏相应页面
  const pages = document.querySelectorAll('[id^="page-"]');
  pages.forEach(page => {
    if (page.id === `page-${pageName}`) {
      page.classList.remove('hidden');
    } else {
      page.classList.add('hidden');
    }
  });
  
  // 如果切换到存储页面，刷新存储信息
  if (pageName === 'storage') {
    loadStorageInfo();
  }
}

/**
 * 初始化刷新存储按钮
 */
function initRefreshStorageButton() {
  const refreshBtn = document.getElementById('refresh-storage-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // 显示加载状态
      refreshBtn.classList.add('loading');
      
      // 加载存储信息
      loadStorageInfo().finally(() => {
        // 无论成功失败，都移除加载状态
        setTimeout(() => {
          refreshBtn.classList.remove('loading');
        }, 500);
      });
    });
  }
}

/**
 * 初始化主题切换
 */
function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  
  // 检查首选主题
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggle.checked = true;
  }
  
  // 主题切换事件
  themeToggle.addEventListener('change', () => {
    const theme = themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    
    // 更新图表主题
    updateChartsTheme();
  });
}

/**
 * 初始化时间范围选择器
 */
function initTimeRangeSelector() {
  const buttons = document.querySelectorAll('.time-range-btn');
  
  // 默认选中1小时按钮
  const defaultBtn = document.querySelector('.time-range-btn[data-range="1h"]');
  if (defaultBtn) {
    defaultBtn.classList.add('active');
  }
  
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // 移除所有按钮的活动状态
      buttons.forEach(b => b.classList.remove('active'));
      
      // 设置当前按钮为活动状态
      btn.classList.add('active');
      
      // 更新当前时间范围并加载数据
      currentTimeRange = btn.dataset.range;
      console.log(`切换到时间范围: ${currentTimeRange}`);
      loadStats(currentTimeRange);
    });
  });
}

/**
 * 加载存储使用情况
 */
async function loadStorageInfo() {
  try {
    // 获取存储使用情况
    const response = await fetch(`${API_BASE_URL}/api/storage-info`);
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    const data = await response.json();
    
    // 更新存储使用情况显示
    updateStorageInfoDisplay(data);
    
    return data;
  } catch (error) {
    console.error('加载存储使用情况失败:', error);
    return null;
  }
}

/**
 * 更新存储使用情况显示
 * @param {Object} data - 存储使用情况数据
 */
function updateStorageInfoDisplay(data) {
  // 更新行数
  document.getElementById('row-count').textContent = formatNumber(data.rowCount);
  
  // 更新存储空间
  document.getElementById('storage-size').textContent = `${data.estimatedSizeGB} GB`;
  
  // 更新每行大小
  document.getElementById('row-size').textContent = formatNumber(data.rowSizeBytes);
  
  // 更新进度条
  const progressBar = document.getElementById('storage-progress');
  const storagePercent = document.getElementById('storage-percent');
  
  // 计算占用百分比 (基于5GB免费额度)
  const percentUsed = (parseFloat(data.estimatedSizeGB) / 5) * 100;
  progressBar.value = parseFloat(data.estimatedSizeGB) * 1024; // 转换为MB
  storagePercent.textContent = `${percentUsed.toFixed(2)}%`;
  
  // 根据使用情况设置进度条颜色
  if (percentUsed > 80) {
    progressBar.classList.add('progress-error');
    progressBar.classList.remove('progress-warning', 'progress-success');
  } else if (percentUsed > 50) {
    progressBar.classList.add('progress-warning');
    progressBar.classList.remove('progress-error', 'progress-success');
  } else {
    progressBar.classList.add('progress-success');
    progressBar.classList.remove('progress-error', 'progress-warning');
  }
}

/**
 * 加载统计数据
 * @param {string} timeRange - 时间范围 (1h, 6h, 24h, 7d, 30d)
 */
async function loadStats(timeRange) {
  try {
    // 显示加载指示器
    showLoading(true);
    
    console.log(`正在加载 ${timeRange} 的统计数据...`);
    
    // 获取统计数据
    const response = await fetch(`${API_BASE_URL}/api/stats?timeRange=${timeRange}`);
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.length === 0) {
      console.warn('没有可用的统计数据');
      return;
    }
    
    console.log(`成功获取 ${data.length} 条数据点`);
    
    // 更新统计信息
    updateStatsDisplay(data);
    
    // 更新图表
    updateCharts(data);
    
  } catch (error) {
    console.error('加载统计数据失败:', error);
    // 显示错误通知
    // ...
  } finally {
    // 隐藏加载指示器
    showLoading(false);
  }
}

/**
 * 更新统计显示
 * @param {Array} data - 统计数据
 */
function updateStatsDisplay(data) {
  // 获取最新的数据点
  const latestData = data[data.length - 1];
  
  // 获取前一个数据点(用于趋势)
  const previousData = data.length > 1 ? data[data.length - 2] : null;
  
  // 更新跟踪器信息
  document.getElementById('tracker-info').textContent = `Tracker ID: ${latestData.tracker_id}`;
  
  // 更新基本统计数据
  document.getElementById('torrents-count').textContent = formatNumber(latestData.torrents_count);
  document.getElementById('peers-count').textContent = formatNumber(latestData.peers_count);
  document.getElementById('seeds-count').textContent = formatNumber(latestData.seeds_count);
  document.getElementById('completed-count').textContent = formatNumber(latestData.completed_count);
  
  // 更新运行时间 - 总时间显示
  document.getElementById('uptime').textContent = formatUptime(latestData.uptime);
  
  // 更新运行时间 - 细分显示
  const seconds = latestData.uptime;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  
  document.getElementById('uptime-days').textContent = days;
  document.getElementById('uptime-hours').textContent = hours;
  document.getElementById('uptime-minutes').textContent = minutes;
  document.getElementById('uptime-seconds').textContent = remainingSeconds;
  
  // 更新趋势指标
  if (previousData) {
    updateTrendIndicator('torrents-trend', latestData.torrents_count, previousData.torrents_count);
    updateTrendIndicator('peers-trend', latestData.peers_count, previousData.peers_count);
    updateTrendIndicator('seeds-trend', latestData.seeds_count, previousData.seeds_count);
    updateTrendIndicator('completed-trend', latestData.completed_count, previousData.completed_count);
  }
}

/**
 * 更新趋势指示器
 * @param {string} elementId - 元素ID
 * @param {number} current - 当前值
 * @param {number} previous - 前一个值
 */
function updateTrendIndicator(elementId, current, previous) {
  const element = document.getElementById(elementId);
  
  if (!element) return;
  
  // 计算变化百分比
  const diff = current - previous;
  const percentChange = previous !== 0 ? (diff / previous) * 100 : 0;
  
  // 移除之前的类
  element.classList.remove('trend-up', 'trend-down', 'trend-neutral');
  
  // 设置趋势文本和类
  if (diff > 0) {
    element.textContent = `↑ ${Math.abs(percentChange).toFixed(1)}%`;
    element.classList.add('trend-up');
  } else if (diff < 0) {
    element.textContent = `↓ ${Math.abs(percentChange).toFixed(1)}%`;
    element.classList.add('trend-down');
  } else {
    element.textContent = `0%`;
    element.classList.add('trend-neutral');
  }
}

/**
 * 更新所有图表
 * @param {Array} data - 统计数据
 */
function updateCharts(data) {
  // 准备图表数据
  const timestamps = data.map(d => new Date(d.timestamp));
  
  // 用户统计图表
  updateUsersChart(timestamps, data);
  
  // 连接统计图表
  updateConnectionsChart(timestamps, data);
  
  // TCP连接类型图表
  updateTcpChart(timestamps, data);
  
  // UDP连接类型图表
  updateUdpChart(timestamps, data);
  
  // 详细统计图表
  updateTorrentsDetailChart(timestamps, data);
  updatePeersDetailChart(timestamps, data);
  updateSeedsDetailChart(timestamps, data);
  updateCompletedDetailChart(timestamps, data);
}

/**
 * 更新用户统计图表
 * @param {Array} timestamps - 时间戳
 * @param {Array} data - 统计数据
 */
function updateUsersChart(timestamps, data) {
  const ctx = document.getElementById('users-chart').getContext('2d');
  const latestData = data[data.length - 1];
  
  // 更新徽章数据
  document.getElementById('users-count-badge').textContent = formatNumber(latestData.peers_count);
  
  // 使用固定颜色，不依赖CSS变量
  const chartData = {
    labels: timestamps,
    datasets: [
      {
        label: '种子数',
        data: data.map(d => d.torrents_count),
        borderColor: '#f87171', // 直接使用十六进制颜色
        backgroundColor: 'rgba(248, 113, 113, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: 'Peers',
        data: data.map(d => d.peers_count),
        borderColor: '#facc15', // 黄色
        backgroundColor: 'rgba(250, 204, 21, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: '做种者',
        data: data.map(d => d.seeds_count),
        borderColor: '#4ade80', // 绿色
        backgroundColor: 'rgba(74, 222, 128, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: '已完成',
        data: data.map(d => d.completed_count),
        borderColor: '#60a5fa', // 蓝色
        backgroundColor: 'rgba(96, 165, 250, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      }
    ]
  };
  
  if (usersChart) {
    usersChart.data = chartData;
    usersChart.update();
  } else {
    usersChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: getChartOptions('用户统计')
    });
  }
}

/**
 * 更新连接统计图表
 * @param {Array} timestamps - 时间戳
 * @param {Array} data - 统计数据
 */
function updateConnectionsChart(timestamps, data) {
  const ctx = document.getElementById('connections-chart').getContext('2d');
  const latestData = data[data.length - 1];
  
  // 更新徽章数据
  document.getElementById('connections-count-badge').textContent = formatNumber(latestData.tcp_accept + latestData.udp_overall);
  
  const chartData = {
    labels: timestamps,
    datasets: [
      {
        label: 'TCP总连接',
        data: data.map(d => d.tcp_accept),
        borderColor: '#f87171', // 红色
        backgroundColor: 'rgba(248, 113, 113, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: 'UDP总连接',
        data: data.map(d => d.udp_overall),
        borderColor: '#facc15', // 黄色
        backgroundColor: 'rgba(250, 204, 21, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      }
    ]
  };
  
  if (connectionsChart) {
    connectionsChart.data = chartData;
    connectionsChart.update();
  } else {
    connectionsChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: getChartOptions('连接统计')
    });
  }
}

/**
 * 更新TCP连接类型图表
 * @param {Array} timestamps - 时间戳
 * @param {Array} data - 统计数据
 */
function updateTcpChart(timestamps, data) {
  const ctx = document.getElementById('tcp-chart').getContext('2d');
  const latestData = data[data.length - 1];
  
  // 更新徽章数据
  document.getElementById('tcp-count-badge').textContent = formatNumber(latestData.tcp_accept);
  
  const chartData = {
    labels: timestamps,
    datasets: [
      {
        label: '公告 (Announce)',
        data: data.map(d => d.tcp_announce),
        borderColor: '#f87171', // 红色
        backgroundColor: 'rgba(248, 113, 113, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: '刮削 (Scrape)',
        data: data.map(d => d.tcp_scrape),
        borderColor: '#facc15', // 黄色
        backgroundColor: 'rgba(250, 204, 21, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      }
    ]
  };
  
  if (tcpChart) {
    tcpChart.data = chartData;
    tcpChart.update();
  } else {
    tcpChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: getChartOptions('TCP连接类型')
    });
  }
}

/**
 * 更新UDP连接类型图表
 * @param {Array} timestamps - 时间戳
 * @param {Array} data - 统计数据
 */
function updateUdpChart(timestamps, data) {
  const ctx = document.getElementById('udp-chart').getContext('2d');
  const latestData = data[data.length - 1];
  
  // 更新徽章数据
  document.getElementById('udp-count-badge').textContent = formatNumber(latestData.udp_overall);
  
  const chartData = {
    labels: timestamps,
    datasets: [
      {
        label: '连接 (Connect)',
        data: data.map(d => d.udp_connect),
        borderColor: '#f87171', // 红色
        backgroundColor: 'rgba(248, 113, 113, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: '公告 (Announce)',
        data: data.map(d => d.udp_announce),
        borderColor: '#facc15', // 黄色
        backgroundColor: 'rgba(250, 204, 21, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: '刮削 (Scrape)',
        data: data.map(d => d.udp_scrape),
        borderColor: '#4ade80', // 绿色
        backgroundColor: 'rgba(74, 222, 128, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: '不匹配 (Missmatch)',
        data: data.map(d => d.udp_missmatch),
        borderColor: '#60a5fa', // 蓝色
        backgroundColor: 'rgba(96, 165, 250, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      }
    ]
  };
  
  if (udpChart) {
    udpChart.data = chartData;
    udpChart.update();
  } else {
    udpChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: getChartOptions('UDP连接类型')
    });
  }
}

/**
 * 更新种子数量详细图表和统计信息
 * @param {Array} timestamps - 时间戳
 * @param {Array} data - 统计数据
 */
function updateTorrentsDetailChart(timestamps, data) {
  // 获取最新数据
  const latestData = data[data.length - 1];
  
  // 更新徽章数据
  document.getElementById('torrents-count-badge').textContent = formatNumber(latestData.torrents_count);
  
  // 更新Mutex和Iterator计数
  document.getElementById('torrents-mutex').textContent = formatNumber(latestData.torrents_count);
  document.getElementById('torrents-iterator').textContent = formatNumber(latestData.torrents_iterator || latestData.torrents_count);
  
  // 绘制图表
  const ctx = document.getElementById('torrents-detail-chart').getContext('2d');
  
  const chartData = {
    labels: timestamps,
    datasets: [
      {
        label: '种子数量',
        data: data.map(d => d.torrents_count),
        borderColor: '#f87171', // 红色
        backgroundColor: 'rgba(248, 113, 113, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      }
    ]
  };
  
  if (torrentsDetailChart) {
    torrentsDetailChart.data = chartData;
    torrentsDetailChart.update();
  } else {
    torrentsDetailChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: getDetailChartOptions('种子数量趋势')
    });
  }
}

/**
 * 更新Peers详细图表和统计信息
 * @param {Array} timestamps - 时间戳
 * @param {Array} data - 统计数据
 */
function updatePeersDetailChart(timestamps, data) {
  // 获取最新数据
  const latestData = data[data.length - 1];
  
  // 更新徽章数据
  document.getElementById('peers-count-badge').textContent = formatNumber(latestData.peers_count);
  
  // 计算做种比例和下载比例
  const seedRatio = latestData.seeds_count / latestData.peers_count * 100;
  const leechRatio = (latestData.peers_count - latestData.seeds_count) / latestData.peers_count * 100;
  
  document.getElementById('seed-ratio').textContent = `${seedRatio.toFixed(1)}%`;
  document.getElementById('leech-ratio').textContent = `${leechRatio.toFixed(1)}%`;
  
  // 绘制图表
  const ctx = document.getElementById('peers-detail-chart').getContext('2d');
  
  const chartData = {
    labels: timestamps,
    datasets: [
      {
        label: '总Peers',
        data: data.map(d => d.peers_count),
        borderColor: '#f87171', // 红色
        backgroundColor: 'rgba(248, 113, 113, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      },
      {
        label: '做种者',
        data: data.map(d => d.seeds_count),
        borderColor: '#4ade80', // 绿色
        backgroundColor: 'rgba(74, 222, 128, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      }
    ]
  };
  
  if (peersDetailChart) {
    peersDetailChart.data = chartData;
    peersDetailChart.update();
  } else {
    peersDetailChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: getDetailChartOptions('Peers趋势')
    });
  }
}

/**
 * 更新做种者详细图表和统计信息
 * @param {Array} timestamps - 时间戳
 * @param {Array} data - 统计数据
 */
function updateSeedsDetailChart(timestamps, data) {
  // 获取最新数据
  const latestData = data[data.length - 1];
  
  // 更新徽章数据
  document.getElementById('seeds-count-badge').textContent = formatNumber(latestData.seeds_count);
  
  // 计算占总Peers百分比
  const seedPercent = latestData.seeds_count / latestData.peers_count * 100;
  
  // 更新进度条
  document.getElementById('seed-percent-bar').style.width = `${seedPercent}%`;
  document.getElementById('seed-percent-text').textContent = `${seedPercent.toFixed(1)}%`;
  
  // 绘制图表
  const ctx = document.getElementById('seeds-detail-chart').getContext('2d');
  
  const chartData = {
    labels: timestamps,
    datasets: [
      {
        label: '做种者数量',
        data: data.map(d => d.seeds_count),
        borderColor: '#4ade80', // 绿色
        backgroundColor: 'rgba(74, 222, 128, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      }
    ]
  };
  
  if (seedsDetailChart) {
    seedsDetailChart.data = chartData;
    seedsDetailChart.update();
  } else {
    seedsDetailChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: getDetailChartOptions('做种者趋势')
    });
  }
}

/**
 * 更新已完成详细图表和统计信息
 * @param {Array} timestamps - 时间戳
 * @param {Array} data - 统计数据
 */
function updateCompletedDetailChart(timestamps, data) {
  // 获取最新数据
  const latestData = data[data.length - 1];
  
  // 更新徽章数据
  document.getElementById('completed-count-badge').textContent = formatNumber(latestData.completed_count);
  
  // 计算平均每种子完成数
  const avgCompleted = latestData.completed_count / latestData.torrents_count;
  document.getElementById('avg-completed').textContent = avgCompleted.toFixed(2);
  
  // 绘制图表
  const ctx = document.getElementById('completed-detail-chart').getContext('2d');
  
  const chartData = {
    labels: timestamps,
    datasets: [
      {
        label: '已完成数量',
        data: data.map(d => d.completed_count),
        borderColor: '#60a5fa', // 蓝色
        backgroundColor: 'rgba(96, 165, 250, 0.2)',
        tension: 0.4,
        borderWidth: 1.5,
        fill: true
      }
    ]
  };
  
  if (completedDetailChart) {
    completedDetailChart.data = chartData;
    completedDetailChart.update();
  } else {
    completedDetailChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: getDetailChartOptions('完成数趋势')
    });
  }
}

/**
 * 获取图表共享选项
 * @param {string} title - 图表标题
 * @returns {Object} Chart.js选项
 */
function getChartOptions(title) {
  const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
  
  // 明确定义颜色而不使用CSS变量
  const colors = {
    background: isDarkMode ? '#1d232a' : '#ffffff',
    cardBackground: isDarkMode ? '#191e24' : '#ffffff',
    text: isDarkMode ? '#a6adba' : '#1f2937',
    gridLines: isDarkMode ? 'rgba(166, 173, 186, 0.1)' : 'rgba(31, 41, 55, 0.1)',
    tooltipBackground: isDarkMode ? '#2a323c' : '#f3f4f6'
  };
  
  // 根据时间范围设置时间刻度
  const timeSettings = getTimeSettings(currentTimeRange);
  
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      customCanvasBackgroundColor: {
        color: colors.cardBackground
      },
      filler: {
        propagate: false
      },
      title: {
        display: false,
        text: title,
        color: colors.text,
        font: {
          size: 14,
          weight: 'normal'
        }
      },
      legend: {
        labels: {
          color: colors.text,
          usePointStyle: true,
          pointStyle: 'circle',
          font: {
            size: 12
          },
          boxWidth: 10,
          padding: 15
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: colors.tooltipBackground,
        titleColor: colors.text,
        bodyColor: colors.text,
        borderColor: colors.gridLines,
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: function(tooltipItems) {
            const date = new Date(tooltipItems[0].parsed.x);
            return date.toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });
          }
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: timeSettings.unit,
          stepSize: timeSettings.stepSize,
          displayFormats: {
            minute: 'HH:mm',
            hour: 'MM-dd HH:mm',
            day: 'MM-dd'
          }
        },
        grid: {
          color: colors.gridLines,
          drawBorder: false,
          display: true
        },
        ticks: {
          color: colors.text,
          maxTicksLimit: 10,
          font: {
            size: 11
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: colors.gridLines,
          drawBorder: false,
          display: true
        },
        ticks: {
          color: colors.text,
          font: {
            size: 11
          }
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  };
}

/**
 * 获取详细图表共享选项
 * @param {string} title - 图表标题
 * @returns {Object} Chart.js选项
 */
function getDetailChartOptions(title) {
  const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
  
  // 明确定义颜色而不使用CSS变量
  const colors = {
    background: isDarkMode ? '#1d232a' : '#ffffff',
    cardBackground: isDarkMode ? '#191e24' : '#ffffff',
    text: isDarkMode ? '#a6adba' : '#1f2937',
    gridLines: isDarkMode ? 'rgba(166, 173, 186, 0.1)' : 'rgba(31, 41, 55, 0.1)',
    tooltipBackground: isDarkMode ? '#2a323c' : '#f3f4f6'
  };
  
  // 根据时间范围设置时间刻度
  const timeSettings = getTimeSettings(currentTimeRange);
  
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      customCanvasBackgroundColor: {
        color: colors.cardBackground
      },
      filler: {
        propagate: false
      },
      title: {
        display: false,
        text: title,
        color: colors.text,
        font: {
          size: 14,
          weight: 'normal'
        }
      },
      legend: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: colors.tooltipBackground,
        titleColor: colors.text,
        bodyColor: colors.text,
        borderColor: colors.gridLines,
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: function(tooltipItems) {
            const date = new Date(tooltipItems[0].parsed.x);
            return date.toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });
          }
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: timeSettings.unit,
          stepSize: timeSettings.stepSize,
          displayFormats: {
            minute: 'HH:mm',
            hour: 'MM-dd HH:mm',
            day: 'MM-dd'
          }
        },
        grid: {
          color: colors.gridLines,
          drawBorder: false,
          display: true
        },
        ticks: {
          color: colors.text,
          maxTicksLimit: 8,
          font: {
            size: 11
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: colors.gridLines,
          drawBorder: false,
          display: true
        },
        ticks: {
          color: colors.text,
          font: {
            size: 11
          }
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  };
}

/**
 * 根据时间范围获取时间单位和步长
 * @param {string} timeRange - 时间范围
 * @returns {Object} 时间设置对象
 */
function getTimeSettings(timeRange) {
  switch (timeRange) {
    case '1h':
      return { unit: 'minute', stepSize: 1 };
    case '6h':
      return { unit: 'minute', stepSize: 30 };
    case '24h':
      return { unit: 'hour', stepSize: 2 };
    case '7d':
      return { unit: 'day', stepSize: 1 };
    case '30d':
      return { unit: 'day', stepSize: 3 };
    default:
      return { unit: 'hour', stepSize: 1 };
  }
}

/**
 * 根据时间范围获取图表时间单位
 * @param {string} timeRange - 时间范围
 * @returns {string} 时间单位
 */
function getTimeUnit(timeRange) {
  const settings = getTimeSettings(timeRange);
  return settings.unit;
}

/**
 * 更新图表主题
 */
function updateChartsTheme() {
  const charts = [
    usersChart, connectionsChart, tcpChart, udpChart,
    torrentsDetailChart, peersDetailChart, seedsDetailChart, completedDetailChart
  ];
  
  const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
  const backgroundColor = isDarkMode ? '#191e24' : '#ffffff';
  
  // 更新所有图表的背景色
  charts.forEach(chart => {
    if (chart && chart.canvas) {
      // 更新canvas背景色
      chart.canvas.style.backgroundColor = backgroundColor;
      
      // 更新时间单位
      if (chart.options && chart.options.scales && chart.options.scales.x) {
        const timeSettings = getTimeSettings(currentTimeRange);
        chart.options.scales.x.time.unit = timeSettings.unit;
        chart.options.scales.x.time.stepSize = timeSettings.stepSize;
      }
      
      // 强制重绘图表
      chart.update();
    }
  });
  
  // 完全重绘所有图表，确保颜色正确
  loadStats(currentTimeRange);
}

/**
 * 显示/隐藏加载指示器
 * @param {boolean} show - 是否显示
 */
function showLoading(show) {
  const loadingIndicator = document.getElementById('loading-indicator');
  
  if (show) {
    loadingIndicator.classList.remove('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

/**
 * 格式化数字
 * @param {number} num - 数字
 * @returns {string} 格式化后的数字
 */
function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  } else {
    return num.toString();
  }
}

/**
 * 格式化运行时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的运行时间
 */
function formatUptime(seconds) {
  if (seconds === null || seconds === undefined) return '-';
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  
  let result = [];
  
  if (days > 0) {
    result.push(`${days}天`);
  }
  
  if (hours > 0 || days > 0) {
    result.push(`${hours}小时`);
  }
  
  if (minutes > 0 || hours > 0 || days > 0) {
    result.push(`${minutes}分钟`);
  }
  
  result.push(`${remainingSeconds}秒`);
  
  return result.join(' ');
} 