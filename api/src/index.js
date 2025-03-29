/**
 * OpenTracker 统计数据收集器
 * 
 * 该Worker负责:
 * 1. 定期从Tracker服务器获取XML统计数据
 * 2. 解析XML数据并存储到D1数据库
 * 3. 提供API端点供前端查询统计数据
 */

import { XMLParser } from 'fast-xml-parser';

// 解析XML统计数据
async function parseXmlStats(xmlText) {
  // 使用 fast-xml-parser 解析 XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });
  
  const xmlDoc = parser.parse(xmlText);
  
  const getValue = (path) => {
    const parts = path.split('.').map(p => p.trim());
    let current = xmlDoc;
    for (const part of parts) {
      if (!current || !current[part]) return null;
      current = current[part];
    }
    return current;
  };

  // 提取基本统计信息
  const stats = {
    tracker_id: getValue("stats.tracker_id"),
    version: getValue("stats.version"),
    uptime: parseInt(getValue("stats.uptime") || 0),
    torrents_count: parseInt(getValue("stats.torrents.count_mutex") || 0),
    torrents_iterator: parseInt(getValue("stats.torrents.count_iterator") || 0),
    peers_count: parseInt(getValue("stats.peers.count") || 0),
    seeds_count: parseInt(getValue("stats.seeds.count") || 0),
    completed_count: parseInt(getValue("stats.completed.count") || 0),
    
    // 连接统计
    tcp_accept: parseInt(getValue("stats.connections.tcp.accept") || 0),
    tcp_announce: parseInt(getValue("stats.connections.tcp.announce") || 0),
    tcp_scrape: parseInt(getValue("stats.connections.tcp.scrape") || 0),
    
    udp_overall: parseInt(getValue("stats.connections.udp.overall") || 0),
    udp_connect: parseInt(getValue("stats.connections.udp.connect") || 0),
    udp_announce: parseInt(getValue("stats.connections.udp.announce") || 0),
    udp_scrape: parseInt(getValue("stats.connections.udp.scrape") || 0),
    udp_missmatch: parseInt(getValue("stats.connections.udp.missmatch") || 0),
    
    livesync_count: parseInt(getValue("stats.connections.livesync.count") || 0),
    
    // Debug信息
    debug: {
      // Renew计数（存储为对象，键为间隔值）
      renew: {},
      
      // HTTP错误
      http_errors: {},
      
      // Mutex Stall计数
      mutex_stall: parseInt(getValue("stats.debug.mutex_stall.count") || 0)
    },
    
    // 时间戳
    timestamp: new Date().toISOString()
  };
  
  // 提取所有renew计数
  const renewCounts = getValue("stats.debug.renew.count");
  if (Array.isArray(renewCounts)) {
    renewCounts.forEach(node => {
      const interval = node["@_interval"];
      if (interval) {
        stats.debug.renew[interval] = parseInt(node["#text"] || 0);
      }
    });
  }
  
  // 提取所有HTTP错误计数
  const httpErrors = getValue("stats.debug.http_error.count");
  if (Array.isArray(httpErrors)) {
    httpErrors.forEach(node => {
      const code = node["@_code"];
      if (code) {
        stats.debug.http_errors[code] = parseInt(node["#text"] || 0);
      }
    });
  }
  
  return stats;
}

// 创建数据库表(如果不存在)
async function initializeDatabase(db) {
  try {
    // 创建统计数据表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS tracker_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tracker_id TEXT,
        version TEXT,
        uptime INTEGER,
        torrents_count INTEGER,
        torrents_iterator INTEGER,
        peers_count INTEGER,
        seeds_count INTEGER,
        completed_count INTEGER,
        tcp_accept INTEGER,
        tcp_announce INTEGER,
        tcp_scrape INTEGER,
        udp_overall INTEGER,
        udp_connect INTEGER,
        udp_announce INTEGER,
        udp_scrape INTEGER,
        udp_missmatch INTEGER,
        livesync_count INTEGER,
        debug_data TEXT,
        timestamp TEXT
      )
    `).run();
    
    // 创建采样信息表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS sampling_info (
        id INTEGER PRIMARY KEY,
        last_minute_sample TEXT,
        last_10min_sample TEXT
      )
    `).run();
    
    // 确保有一条采样信息记录
    const samplingInfo = await db.prepare(`SELECT COUNT(*) as count FROM sampling_info`).first();
    if (!samplingInfo || samplingInfo.count === 0) {
      await db.prepare(`INSERT INTO sampling_info (id, last_minute_sample, last_10min_sample) VALUES (1, NULL, NULL)`).run();
    }
  } catch (error) {
    console.error("初始化数据库失败:", error);
    throw error;
  }
}

// 执行数据清理 - 保留最近30天的数据
async function cleanupOldData(db) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffDate = thirtyDaysAgo.toISOString();
  
  // 计算数据库存储使用量
  const statsCount = await db.prepare(`SELECT COUNT(*) as count FROM tracker_stats`).first();
  console.log(`当前存储的统计记录数: ${statsCount.count}`);
  
  // 删除旧数据
  await db.prepare(
    "DELETE FROM tracker_stats WHERE timestamp < ?"
  ).bind(cutoffDate).run();
}

// 估算数据库存储空间
async function estimateStorageSize(db) {
  // 获取一行数据作为样本
  const sampleRow = await db.prepare(`SELECT * FROM tracker_stats LIMIT 1`).first();
  
  if (!sampleRow) return { rowCount: 0, estimatedSize: 0 };
  
  // 估算一行数据的大小 (JSON序列化后的大小作为粗略估计)
  const rowSizeBytes = JSON.stringify(sampleRow).length;
  
  // 获取总行数
  const rowCount = await db.prepare(`SELECT COUNT(*) as count FROM tracker_stats`).first();
  
  // 估算总存储大小 (字节)
  const estimatedSizeBytes = rowCount.count * rowSizeBytes;
  
  // 转换为MB
  const estimatedSizeMB = estimatedSizeBytes / (1024 * 1024);
  
  return {
    rowCount: rowCount.count,
    estimatedSize: estimatedSizeMB,
    rowSizeBytes: rowSizeBytes
  };
}

// 确定是否应该存储当前采样
async function shouldStoreCurrentSample(db, env) {
  const now = new Date();
  const detailedHours = parseInt(env.STORE_DETAILED_HOURS || "1");
  
  // 获取最后存储的时间点
  const samplingInfo = await db.prepare(`SELECT * FROM sampling_info WHERE id = 1`).first();
  
  // 解析最后一次10分钟采样的时间
  let last10MinSampleTime = null;
  if (samplingInfo.last_10min_sample) {
    last10MinSampleTime = new Date(samplingInfo.last_10min_sample);
  }
  
  // 计算当前分钟和10分钟整点
  const currentMinute = now.getMinutes();
  const is10MinInterval = currentMinute % 10 === 0;
  
  // 检查是否处于详细数据存储时段内(最近detailedHours小时)
  const recentDataCutoff = new Date();
  recentDataCutoff.setHours(recentDataCutoff.getHours() - detailedHours);
  
  // 获取最近一条记录的时间戳
  const latestRecord = await db.prepare(`
    SELECT timestamp FROM tracker_stats 
    ORDER BY timestamp DESC LIMIT 1
  `).first();
  
  let isRecentDataPeriod = false;
  if (latestRecord) {
    const latestRecordTime = new Date(latestRecord.timestamp);
    isRecentDataPeriod = latestRecordTime > recentDataCutoff;
  } else {
    // 如果没有数据，则默认为需要详细采样期
    isRecentDataPeriod = true;
  }
  
  // 是否存储当前样本的决策逻辑
  let shouldStore = false;
  
  if (isRecentDataPeriod) {
    // 在详细数据期内，存储每分钟的数据
    shouldStore = true;
  } else if (is10MinInterval) {
    // 超过详细数据期，只存储10分钟间隔的数据
    shouldStore = (!last10MinSampleTime || 
                 (now.getTime() - last10MinSampleTime.getTime() >= 10 * 60 * 1000));
  }
  
  // 如果决定存储，则更新采样信息
  if (shouldStore) {
    const nowIso = now.toISOString();
    if (is10MinInterval) {
      await db.prepare(`
        UPDATE sampling_info 
        SET last_minute_sample = ?, last_10min_sample = ? 
        WHERE id = 1
      `).bind(nowIso, nowIso).run();
    } else {
      await db.prepare(`
        UPDATE sampling_info 
        SET last_minute_sample = ? 
        WHERE id = 1
      `).bind(nowIso).run();
    }
  }
  
  return shouldStore;
}

// 收集和存储跟踪器统计数据
async function collectAndStoreStats(env) {
  try {
    // 获取统计数据
    const response = await fetch(env.TRACKER_URL);
    if (!response.ok) {
      throw new Error(`获取Tracker统计数据失败: ${response.status}`);
    }
    
    const xmlText = await response.text();
    const stats = await parseXmlStats(xmlText);
    
    // 确保数据库已初始化
    await initializeDatabase(env.DB);
    
    // 判断是否需要存储此次采样
    const shouldStore = await shouldStoreCurrentSample(env.DB, env);
    
    if (shouldStore) {
      // 存储统计数据
      await env.DB.prepare(`
        INSERT INTO tracker_stats (
          tracker_id, version, uptime, torrents_count, torrents_iterator, peers_count, seeds_count, completed_count,
          tcp_accept, tcp_announce, tcp_scrape, udp_overall, udp_connect, udp_announce, 
          udp_scrape, udp_missmatch, livesync_count, debug_data, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        stats.tracker_id, stats.version, stats.uptime, stats.torrents_count, stats.torrents_iterator,
        stats.peers_count, stats.seeds_count, stats.completed_count,
        stats.tcp_accept, stats.tcp_announce, stats.tcp_scrape,
        stats.udp_overall, stats.udp_connect, stats.udp_announce,
        stats.udp_scrape, stats.udp_missmatch, stats.livesync_count,
        JSON.stringify(stats.debug), stats.timestamp
      ).run();
      
      console.log(`已存储统计数据，时间戳: ${stats.timestamp}`);
      
      // 估算存储空间
      const storageInfo = await estimateStorageSize(env.DB);
      console.log(`估计的数据库大小: ${storageInfo.estimatedSize.toFixed(2)} MB (${storageInfo.rowCount} 行)`);
      
      // 清理旧数据
      await cleanupOldData(env.DB);
    } else {
      console.log(`跳过此次采样存储，时间戳: ${stats.timestamp}`);
    }
    
    return { 
      success: true, 
      message: shouldStore ? "统计数据已成功收集和存储" : "已收集但未存储此次采样",
      data: stats
    };
  } catch (error) {
    console.error("收集统计数据失败:", error);
    return { success: false, error: error.message };
  }
}

// 查询统计数据
async function queryStats(db, timeRange) {
  // 根据时间范围计算起始时间
  const now = new Date();
  const startDate = new Date();
  
  switch (timeRange) {
    case "1h":
      startDate.setHours(now.getHours() - 1);
      break;
    case "6h":
      startDate.setHours(now.getHours() - 6);
      break;
    case "24h":
      startDate.setDate(now.getDate() - 1);
      break;
    case "7d":
      startDate.setDate(now.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(now.getDate() - 30);
      break;
    default:
      startDate.setHours(now.getHours() - 24); // 默认为24小时
  }
  
  const startTimestamp = startDate.toISOString();
  
  // 查询数据
  const result = await db.prepare(`
    SELECT * FROM tracker_stats
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).bind(startTimestamp).all();
  
  // 处理结果，将debug_data解析为JSON
  const processedResults = result.results.map(row => {
    try {
      if (row.debug_data) {
        row.debug = JSON.parse(row.debug_data);
      } else {
        row.debug = {};
      }
      delete row.debug_data; // 移除原始字段
    } catch (error) {
      console.error("解析debug_data失败:", error);
      row.debug = {};
    }
    return row;
  });
  
  return processedResults;
}

// 主处理程序
export default {
  // 处理定时任务 - 收集统计数据
  async scheduled(event, env, ctx) {
    return await collectAndStoreStats(env);
  },
  
  // 处理HTTP请求
  async fetch(request, env, ctx) {
    // 允许跨域请求
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    
    // 处理OPTIONS请求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }
    
    // 解析URL和查询参数
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 初始化数据库
    await initializeDatabase(env.DB);
    
    // API路由处理
    if (path === "/api/stats") {
      const timeRange = url.searchParams.get("timeRange") || "24h";
      const data = await queryStats(env.DB, timeRange);
      
      return new Response(JSON.stringify(data), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } 
    // 手动触发数据收集(用于测试)
    else if (path === "/api/collect" && request.method === "POST") {
      const result = await collectAndStoreStats(env);
      
      return new Response(JSON.stringify(result), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 获取存储统计信息
    else if (path === "/api/storage-info") {
      const storageInfo = await estimateStorageSize(env.DB);
      
      return new Response(JSON.stringify({
        rowCount: storageInfo.rowCount,
        estimatedSizeMB: storageInfo.estimatedSize.toFixed(2),
        rowSizeBytes: storageInfo.rowSizeBytes,
        estimatedSizeGB: (storageInfo.estimatedSize / 1024).toFixed(4)
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    else {
      return new Response("未找到对应的API路由", {
        status: 404,
        headers: corsHeaders
      });
    }
  }
}; 