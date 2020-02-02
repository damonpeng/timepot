# timepot
Time marker &amp; report.

## 快速使用

引入 timepot 后，即可随时打点；在需要时输出或上报。
```
timepot.mark();  // anonymous mark
/* some code */
timepot.mark('rendered');  // named mark
timepot.show();  // show result
```

若**统计引入`timepot`之前的时间打点**，则预埋小段代码即可：
```
<script type="text/javascript">
window.timepot = [];
timepit.mark = function(name) {
    timepot.push({ label: name, value: Date.now()});
};
</script>
```
如上述代码，放在在`<head>`中，加载`timepot`后，对应的数据不会丢失；在完成`timepot`加载前，仅支持`timepot.mark()`方法。

或自行组织符合上述格式的数组，通过`timepot.load(data)`传入。

若**在一个页面区分多个统计实例**，则需进行命名。

## 特点

* 多节点：在需要的时机mark即可
* 多实例：按名称区分
* 连接

对接performance 测速

对接 beacon 上报


## 说明文档

* 配置参数


## 场景

preset group:
- performance
- audits
- default

1. 测速

.mark()

2. 计时器

.start()
.stop()


## 依赖

无依赖

## todo

不同域名的dns时间
不同域名的ttfb差异
超过throttle size 的图片
超过throttle time 的transfer
