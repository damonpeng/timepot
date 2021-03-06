# Timepot

<img src="./logo.png" width="128">

[![Npm Version](https://img.shields.io/npm/v/timepot?style=flat-square)](https://www.npmjs.com/package/timepot)
[![Build Status](https://travis-ci.org/damonpeng/timepot.svg?branch=master&style=flat-square)](https://travis-ci.org/damonpeng/timepot)
[![Dependencies](https://img.shields.io/librariesio/dependents/npm/timepot?style=flat-square)](https://libraries.io/npm/timepot)
[![License](https://img.shields.io/npm/l/timepot?style=flat-square)](https://github.com/damonpeng/timepot/blob/master/LICENSE)

Time marker & report for page performance testing.

用于 Web 页面性能测速的打点统计及上报。

[English Version](README.md)(@todo) | [中文版](README_CN.md)

## 快速上手

[示例代码](https://damonpeng.github.io/timepot/examples/demo.html)

**1. 安装**

```bash
npm install timepot --save
```

**2. 使用**

引入`timepot`后，即可随时打点；在需要时输出或上报。

```javascript
timepot.mark();  // anonymous mark
/* SOME CODE HERE */
timepot.mark('rendered');  // named mark

// promise api
timepot.timing().then(function(result) {
    console.log(result);

    // report to server
    timepot.report('SOME_URL', timingData => {
        // do some formatting for timing data that would be sent
        return timingData;
    });
});
```

**简化的秒表模式**

秒表模式：参数简化版，仅关注本次计时的 group 名称，不关心每个打点的命名，自动采用 `tick + index` 递增命名。

 1. `timepot.start('groupName')`：开始统计，一个 groupName 仅调用一次
 2. `timepot.tick('groupName')`：记下一个时刻，可多次调用 tick
 3. `timepot.stop('groupName')`：结束统计，一个 groupName 仅调用一次

如对单个网络请求测速，在请求开始前`timepot.start('cgi')`，在获取到数据后`timepot.stop('cgi')`。


## 特点

 * 简单易用，两种模式：打点模式和秒表模式
 * 多节点：随时需要，随时`mark`
 * 多实例：按`group`名称分组统计，互不干扰
 * 数据完整：对接 performance 数据，优先基于`PerformanceObserver`获取完整数据
 * 支持常见性能评估指标：对标Google [RAIL 性能模型](https://developers.google.com/web/fundamentals/performance/rail)
 * 优化上报方式：支持`navigator.sendBeacon()`上报，可降级为fetch、XHR
 * 数据不丢失：支持延时批量上报，剩余未上报内容将会在页面`beforeunload`时发送


## 设计原理

**数据结构**
每个打点数据包装为一个`Point`，结构为：

```javascript
Point = {
    group: '',      // optional, group name
    name: '',       // optional, name of this point
    time: 0,        // optional, current time in ms
    duration: 0,    // optional, time cost, calculate automatically
    context: {}     // optional, context data
}
```

每次`timepot.mark()`调用时，会写入一次上述结构，并计算duration的值。

内置有如下的group，注意不要覆盖：

- **performance**: 原始性能指标分组，对应常量`timepot.GROUP_PERFORMANCE`，`window.performance.timing`原始值的统计
- **audits**: 常见性能指标分组，对应常量`timepot.GROUP_AUDITS`，基于`window.performance`的进行关键性能指标计算后的统计
- **default**: 匿名分组，对应常量`timepot.GROUP_DEFAULT`，对于匿名（未命名）打点的统计结果

**性能指标**

根据 [Navigation Timing Processing Model](https://w3c.github.io/navigation-timing/#processing-model)，对 [RUM](https://en.wikipedia.org/wiki/Real_user_monitoring) 进行计算的关键渲染路径指标 [CRP](https://developers.google.com/web/fundamentals/performance/critical-rendering-path/measure-crp) 如下表。


| 指标       | 计算方法                               | 含义
|-----------|---------------------------------------|-----------------
| `unload`  | .unloadEventEnd - .unloadEventStart   | 如果非直接打开时有值
| `redirect`| .redirectEnd - .redirectStart         | 同上
| `appCache`| .domainLookupStart - .fetchStart      | 读取缓存耗时，如果存在缓存，则直接跳到requestStart阶段
| `DNS`     | .domainLookupEnd - .domainLookupStart | DNS查询耗时
| `connect` | .connectEnd - .connectStart           | TCP建立连接耗时
| `SSL`     | .connectEnd - .secureConnectionStart  | 非https请求则无此项
| `TTFB`    | .responseStart - .requestStart        | 浏览器[从发起请求到收到第一个字节的回包响应](https://en.wikipedia.org/wiki/Time_to_first_byte)
| `exchange`| .responseEnd - .requestStart      | 网络传输耗时，从发起请求，到收到所有回包内容
| `DOMParse`| .domInteractive - .domLoading         | DOM解析时间
| `DOMContentLoaded`| .domContentLoadedEventStart - .domLoading | [DOM 和 CSSOM](https://calendar.perfplanet.com/2012/deciphering-the-critical-rendering-path/)均准备就绪
| `DOMContentLoadedEvent`| .domContentLoadedEventEnd - .domContentLoadedEventStart | [DOMContentLoaded事件](https://developer.mozilla.org/en-US/docs/Web/API/Document/DOMContentLoaded_event)的执行耗时
| `DOMComplete` | .domComplete - .domLoading        | 页面和所有子资源准备就绪
| `loadEvent`   | .loadEventEnd - .loadEventStart   | onload事件的执行耗时
| `loaded`      | .loadEventEnd - .navigationStart  | 页面加载完成总耗时
| `FP`          | first-paint                       | 首次绘制
| `FCP `        | first-contentful-paint            | 首次内容绘制
| `DNS::[domain]`       | .domainLookupEnd - .domainLookupStart | 每个域名下最耗时的域名查询，如果cache，则无此项
| `exchange::[domain]`  | .responseEnd - .requestStart | 每个域名下最耗时的网络传输，context会列明具体的url、是否压缩、传输大小


## API

**配置参数**

通过`timepot.config`的属性进行全局设置：

- `enablePerformance`：是否允许统计`performance.timing`数据，默认true
- `enableSendBeacon`：发送数据时，是否启用`navigator.sendBeacon()`方法，默认true
- `enableFetch`：发送数据时，是否启用`fetch()`方法，默认true
- `reportPollingTime`：上报的延时时间窗口，达到此阈值则上报，默认1000ms

**方法**
 
| 方法                         | 作用                 | 参数解释
|-----------------------------|----------------------|-----------------
| `timepot.mark(name, point)` | 打点                  | `name`: optional，打点名称，无则匿名，会被统计为default分组；`point`：Optional，打点的其余信息
| `timepot.start(group)`      | 计时器，开始            | `group`：required，String
| `timepot.tick(group)`       | 计时器，打下一个计时点    | `group`：required，String，值同start
| `timepot.stop(group)`       | 计时器，结束            | `group`：required，String，值同start
| `timepot.timing()`          | 统计耗时，Promise 接口  | -
| `timepot.report(url, dataHandler, options)` | 上报数据           | `url`：上报的服务端地址；`dataHandler `：上报的数据的处理函数，需要return有效上报值；`options`：选项，见下文
| `timepot.stopReport()`      | 停止上报        | -
| `timepot.getRawTimingData()`    | 获取原始测速数据    | -
| `timepot.getTimingGroup(group)` | 按分组获取测速数据   | `group`：required，String，分组名称
| `timepot.getPerformance()`   | 获取performance性能测速数据 | -
| `timepot.getAudits()`       | 获取常见性能指标数据         | -
| `timepot.formatTimingDataByGroup(data)`     | 按group格式化原始测速数据 | `data`：required，Array，待格式化的原始测速数据
| `timepot.clear()`           | 清除所有测速数据             | -
| `timepot.console()`         | 以表格形式在控制台打印测速数据 | -

`timepot.report()`支持的 options：

 * options.reportPollingTime: polling to report
 * options.inRealtime: if need sent data in realtime
 * options.enableSendBeacon: if enable navigator.sendBeacon()
 * options.enableFetch: if enable fetch()

## FAQ

**1. 统计引入`timepot`之前的时间测速**

在文档开始处（如<head>)预埋小段代码，加载`timepot`后，对应的数据不会丢失；在完成`timepot`加载前，仅支持`timepot.mark()`方法。

```javascript
<script type="text/javascript">
    window.timepot = window.timepot || [];
    timepot.mark = timepot.mark || function(name, point) {
        !point && (point = {});
        name && (point.name = name);
        point.time = Date.now();
        timepot.push(point);
    };
</script>
```

**2. 在一个页面区分多个统计实例**

需要对每个实例进行命名，以group区分。

```javascript
timepot.mark('start', { group: 'page' });
/* SOME CODE HERE */
timepot.mark('end', { group: 'page' });
```
如上，则以`page`聚拢此组统计，可通过`timepot.getTimingGroup('page')`得到测速结果。


## 外部依赖

小巧，无外部依赖，原生实现。


## License

MIT

If you have any questions that aren't covered here, please let me know.
