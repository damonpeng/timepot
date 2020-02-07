/**
 * Time marker & report for page performance testing.
 * @license MIT
 * @author damonpeng@qq.com
 */
(function() {
    // Essentially, a timepot is an array of time points with multiple custom attributes and methods.
    var timepot,
        gGroupTimepot = {},
        gTimerRunReport = null,
        gLastReportTime,
        gTickIndexMapping = {};

    if (window.timepot) {
        timepot = window.timepot;

        // avoid duplicate init.
        if (timepot.initialized) {
            // @todo use namespace insteadof timepot
            return false;
        }
    } else {
        window.timepot = timepot = [];
    }
    timepot.initialized = true;

    /* timepot point struct
    Point = {
        group: '',
        name: '',
        time: 0,
        duration: 0,  // dynamic calculate
        context: {}
    }
    */

    /**
     * check if is array.
     * @param {Array} arrayLike 
     */
    var isArray = function(arrayLike) {
        return Object.prototype.toString.call(arrayLike) === '[object Array]';
    };

    /**
     * Convert to camel case variable
     * @param {String} str 
     */
    var convertToCamelCase = function(str) {
        return str.replace(/\-{1,}(\w)/g,function (matched, word){
            return word.toUpperCase();
        });
    };

    /**
     * Get current time in ms.
     */
    var getCurrentMsTime = function() {
        return Date.now();
    };

    /**
     * Get performance api
     */
    var getPerformanceAPI = function() {
        return window.performance || window.msPerformance || window.webkitPerformance;
    };

    /**
     * Get performance timing api
     */
    var getPerformanceTimingData = function() {
        return (getPerformanceAPI() || {}).timing;
    };

    /**
     * Get performance timing api
     */
    var getPerformanceEntriesData = function() {
        var performanceAPI = getPerformanceAPI();

        return performanceAPI ? performanceAPI.getEntries() : {};
    };

    /**
     * Send data to server
     * @param {String}          url     Optional
     * @param {Object|String}   data    Optional
     * @param {Object}          options Optional, options.enableSendBeacon indicate whether navigator.sendBeacon enabled.
     */
    var sendBeacon = function(url, data, options) {
        var formattedData = data,
            contentType = 'text/plain';

        if (typeof data === 'string') {
            contentType = 'application/x-www-form-urlencoded';
        } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            contentType = data.type;
        } else if (data && typeof data === 'object') {
            contentType = 'application/json';
            formattedData = JSON.stringify(data);
        }
        
        if (options.enableSendBeacon && 'sendBeacon' in navigator) {
            if (data && typeof data !== 'string' && (typeof Blob === 'undefined' || data instanceof Blob===false)) {
                /* SHOULD NOT set Blob type to 'application/json', or error occurred:
                Failed to execute 'sendBeacon' on 'Navigator': sendBeacon() 
                with a Blob whose type is not any of the CORS-safelisted 
                values for the Content-Type request header is disabled 
                temporarily. See http://crbug.com/490015 for details.

                sendBeacon is follow CORS, but doesn't satisfy CORS spec.
                According to https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#Simple_requests,
                avaliable type values for a "simple request":
                    - application/x-www-form-urlencoded
                    - multipart/form-data
                    - text/plain
                */

                // formattedData = new Blob([JSON.stringify(data)], {type: 'application/json'});
                formattedData = new Blob([JSON.stringify(data)], {type: 'application/x-www-form-urlencoded'});
            }

            return navigator.sendBeacon(url, formattedData);
        } else if ('fetch' in window) {
            // fallback to fetch
            fetch(url, {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                // https://developer.mozilla.org/en-US/docs/Web/API/Request/cache
                cache: 'no-store',
                headers: {
                  'Content-Type': contentType
                },
                body: formattedData
            });
        } else {
            // fallback to XHR
            var xhr;
            
            xhr = typeof XMLHttpRequest !=='undefined' ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
            xhr.open('POST', url, true);
            xhr.withCredentials = true;

            if (typeof Blob !== 'undefined' && data instanceof Blob) {
                data.type && xhr.setRequestHeader('Content-Type', data.type);
            } else {
                xhr.setRequestHeader('Content-Type', contentType + '; charset=utf-8');
            }

            try {
                xhr.send(formattedData);
            } catch (error) {
                return false;
            }

            return true;
        }
    }

    /**
     * initialize
     */
    var init = function() {
        // load data of fake timepot
        if (timepot.length > 0) {
            for (var i=0, l=timepot.length; i<l; i++) {
                var group;

                !timepot[i].group && (timepot[i].group = timepot.GROUP_DEFAULT);
                group = timepot[i].group;

                !timepot[i].name && (timepot[i].name = '');

                !timepot[i].duration && (timepot[i].duration = i > 0 ? timepot[i].time - timepot[i-1].time : 0);

                !gGroupTimepot[group] && (gGroupTimepot[group] = []);
                gGroupTimepot[group].push(timepot[i]);
            }
        }

        gLastReportTime = getCurrentMsTime();
    };

    // preset group name
    timepot.GROUP_DEFAULT = 'default';
    timepot.GROUP_PERFORMANCE = 'performance';
    timepot.GROUP_AUDITS = 'audits';

    // global config
    timepot.config = {
        namespace: 'timepot',   // global name space
        enablePerformance: true,   //  if need performance data
        enableSendBeacon: true,        // enable report data to server through navigator.sendBeacon
        reportDelayTime: 200,   // ms
        reportCountThreshold: 5
    };

    /**
     * Time marker
     * @param {Point} point
     */
    timepot.mark = function(name, point) {
        var marker, currentTime, group, groupTimepotLength, previousTime;

        !point && (point = {});
        group = point.group || timepot.GROUP_DEFAULT;

        !gGroupTimepot[group] && (gGroupTimepot[group] = []);
        groupTimepotLength = gGroupTimepot[group].length;

        currentTime = 'time' in point ? point.time : getCurrentMsTime();
        previousTime = groupTimepotLength > 0 ? gGroupTimepot[group][groupTimepotLength-1].time : 0;

        marker = {
            name: name || '',
            time: currentTime,
            group: group,

            // calculate the difference from the previous one
            duration: 'duration' in point ? point.duration : (
                currentTime>0 && previousTime>0 ? currentTime - previousTime : 0
            )
        };
        point.context && (marker.context = point.context);

        timepot.push(marker);

        gGroupTimepot[group].push(marker);
    };

    /**
     * calculated timing data, Promised api
     */
    timepot.timing = function() {
        // @todo polyfill Promise
        return new Promise(function(resolved, reject) {
            var isNeedWaiting = false;

            if (timepot.config.enablePerformance) {
                // waiting for loading finished to get complete data
                if (document.readyState === 'complete') {
                    timepot.performance();
                    timepot.audits();
                } else {
                    isNeedWaiting = true;

                    if (window.PerformanceObserver) {
                        // a bit faster than load event plus setTimeout.
                        (new PerformanceObserver(function(list, obj) {
                            timepot.performance();
                            timepot.audits();

                            resolved(gGroupTimepot);
                        })).observe({
                            entryTypes: ['navigation']
                        });
                    } else {
                        window.addEventListener('load', function() {
                            // should async to wait for onload event executing
                            setTimeout(function() {
                                timepot.performance();
                                timepot.audits();

                                resolved(gGroupTimepot);
                            }, 0);
                        });
                    }
                }
            }

            !isNeedWaiting && resolved(gGroupTimepot);
        });
    };

    /**
     * performance.timing raw data
     */
    timepot.performance = function() {
        var timing = getPerformanceTimingData();

        if (! timing) {
            return false;
        }

        // performance.timing raw data
        if (gGroupTimepot[timepot.GROUP_PERFORMANCE]) {
            return false;
        }
        
        // https://w3c.github.io/navigation-timing/#processing-model
        // keep order
        nodes = [
            'navigationStart',
            'unloadEventStart',     // maybe 0
            'unloadEventEnd',       // maybe 0
            'redirectStart',        // maybe 0
            'redirectEnd',          // maybe 0
            'fetchStart',
            'domainLookupStart',
            'domainLookupEnd',
            'connectStart',
            'connectEnd',
            'secureConnectionStart',
            'requestStart',
            'responseStart',
            'responseEnd',
            'domLoading',
            'domInteractive',
            'domContentLoadedEventStart',
            'domContentLoadedEventEnd',
            'domComplete',
            'loadEventStart',
            'loadEventEnd'
        ];
        
        for (var i=0,l=nodes.length; i<l; i++) {
            timepot.mark(nodes[i], {
                group: timepot.GROUP_PERFORMANCE,
                time: timing[nodes[i]] || 0
            });
        }
    };

    /**
     * audits for performance.timing
     */
    var auditsPerformanceTiming = function() {
        var timing = getPerformanceTimingData(), group = timepot.GROUP_AUDITS;

        if (! timing) {
            return false;
        }

        // https://developers.google.com/web/fundamentals/performance/navigation-and-resource-timing
        if (! gGroupTimepot[group]) {
            // maybe 0
            timepot.mark('unload', {
                group: group,
                time: timing.unloadEventEnd,
                duration: timing.unloadEventEnd - timing.unloadEventStart
            });

            // maybe 0
            timepot.mark('redirect', {
                group: group,
                time: timing.redirectEnd,
                duration: timing.redirectEnd - timing.redirectStart
            });
            
            timepot.mark('appCache', {
                group: group,
                time: timing.domainLookupStart,
                duration: timing.domainLookupStart - timing.fetchStart
            });

            timepot.mark('DNS', {
                group: group,
                time: timing.domainLookupEnd,
                duration: timing.domainLookupEnd - timing.domainLookupStart
            });

            timepot.mark('connect', {
                group: group,
                time: timing.connectEnd,
                duration: timing.connectEnd - timing.connectStart
            });

            // will be 0 if not https
            if (timing.secureConnectionStart > 0) {
                timepot.mark('SSL', {
                    group: group,
                    time: timing.connectEnd,
                    duration: timing.connectEnd - timing.secureConnectionStart
                });
            }

            // https://en.wikipedia.org/wiki/Time_to_first_byte
            timepot.mark('TTFB', {
                group: group,
                time: timing.responseStart,
                duration: timing.responseStart - timing.requestStart
            });

            // name from https://stackoverflow.com/questions/1039513/what-is-a-request-response-pair-called/23887243#23887243
            timepot.mark('exchange', {
                group: group,
                time: timing.responseEnd,
                duration: timing.responseEnd - timing.requestStart
            });

            // https://developers.google.com/web/fundamentals/performance/critical-rendering-path/measure-crp#navigation-timing
            // domInteractive: DOM is ready.
            timepot.mark('DOMParse', {
                group: group,
                time: timing.domInteractive,
                duration: timing.domInteractive - timing.domLoading
            });

            // domContentLoaded: both the DOM and CSSOM are ready.
            timepot.mark('DOMContentLoaded', {
                group: group,
                time: timing.domContentLoadedEventStart,
                duration: timing.domContentLoadedEventStart - timing.domLoading
            });

            timepot.mark('DOMContentLoadedEvent', {
                group: group,
                time: timing.domContentLoadedEventEnd,
                duration: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart
            });

            // domComplete: the page and all of its subresources are ready.
            timepot.mark('DOMComplete', {
                group: group,
                time: timing.domComplete,
                duration: timing.domComplete - timing.domLoading
            });

            timepot.mark('loadEvent', {
                group: group,
                time: timing.loadEventEnd,
                duration: timing.loadEventEnd - timing.loadEventStart
            });

            timepot.mark('loaded', {
                group: group,
                time: timing.loadEventEnd,
                duration: timing.loadEventEnd - timing.navigationStart
            });
        }

        return true;
    };

    /**
     * audits for performance.getEntries()
     */
    var auditsPerformanceEntries = function() {
        var group = timepot.GROUP_AUDITS,
            entries = getPerformanceEntriesData(),
            startTimestamp = getPerformanceAPI().timeOrigin,
            domainData = {};

        if (! entries) {
            return false;
        }

        for (var i=0, l=entries.length; i<l; i++) {
            var entry = entries[i];

            // https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEntry/entryType
            /*
            - frame, navigation: the document's address.
            - resource: requested resource.
            - mark: when the mark was created by calling performance.mark().
            - measure: when the measure was created by calling performance.measure().
            - paint: Either 'first-paint' or 'first-contentful-paint'.
            - longtask: reports instances of long tasks
            */
            switch(entry.entryType) {
                case 'frame':
                case 'navigation':
                    break;

                case 'resource':
                    var domain = entry.name.match(/:\/\/([^/]*)/)[1];

                    !domainData[domain] && (domainData[domain] = []);
                    domainData[domain].push(entry);
                    break;

                case 'mark':
                    break;

                case 'measure':
                    break;

                case 'paint':
                    timepot.mark({
                        'first-paint': 'FP',
                        'first-contentful-paint': 'FCP'
                    }[entry.name], {
                        group: group,
                        // convert DOMHighResTimeStamp to unix timestamp
                        // https://developer.mozilla.org/en-US/docs/Web/API/DOMHighResTimeStamp#Value
                        time: Math.round(startTimestamp + entry.startTime),
                        // actually, this will always be zero.
                        // https://www.w3.org/TR/paint-timing/#sec-PerformancePaintTiming
                        duration: Math.round(entry.startTime)
                    });
                    break;

                // @todo https://developer.mozilla.org/en-US/docs/Web/API/Long_Tasks_API
                case 'longtask':
                    break;
            }

            /* @todo 
                - First Meaningful Paint
                - Speed Index
                - First CPU Idle
                - Time to Interactive
            */
        }

        analysisPerformanceEntriesByDomain(domainData);

        return true;
    };

    /**
     * Analysis domain performance data
     * @param {Object} domainData 
     */
    var analysisPerformanceEntriesByDomain = function(domainData) {
        var pointMapping = {},
            TYPE_DNS = 'DNS::',
            TYPE_EXCHANGE = 'exchange::',
            startTimestamp = getPerformanceAPI().timeOrigin;

        for(var domain in domainData) {
            for(var i=0, l=domainData[domain].length; i<l; i++) {
                var entry = domainData[domain][i];

                !pointMapping[domain] && (
                    pointMapping[domain] = {},
                    pointMapping[domain][TYPE_DNS] = {
                        duration: 0
                    },
                    pointMapping[domain][TYPE_EXCHANGE] = {
                        duration: 0
                    }
                );
                
                // https://webplatform.github.io/docs/apis/resource_timing/PerformanceResourceTiming/initiatorType/
                /*
                entry.initiatorType
                - css: The initiator is any CSS resource downloaded via the url() syntax, such as @import url(), background: url(), etc.
                - embed: The initiator is the src attribute of the HTML <embed> element.
                - img: The initiator is the src attribute of the HTML <img> element.
                - link: The initiator is the href attribute of the HTML <link> element.
                - object: The initiator is the data attribute of the HTML <object> element.
                - script: The initiator is the src attribute of the HTML <script> element.
                - subdocument: The initiator is the src attribute of the HTML <frame> or HTML <iframe> elements.
                - svg: The initiator is the <svg> element and all resources downloaded as children of the <svg> element.
                - xmlhttprequest: The initiator is a XMLHttpRequest object.
                - other: The initiator is not of any type listed above.
                */

                // max DNS lookup time cost of each domain
                var durationDNS = entry.domainLookupEnd - entry.domainLookupStart;
                if (durationDNS >0 && durationDNS > pointMapping[domain][TYPE_DNS].duration) {
                    pointMapping[domain][TYPE_DNS] = {
                        group: timepot.GROUP_AUDITS,
                        time: Math.round(startTimestamp + entry.domainLookupEnd),
                        duration: Math.round(durationDNS)
                    };
                }

                // max exchange time cost of each domain
                var durationExchange = entry.responseEnd - entry.requestStart;
                if (durationExchange > pointMapping[domain][TYPE_EXCHANGE].duration) {
                    pointMapping[domain][TYPE_EXCHANGE] = {
                        group: timepot.GROUP_AUDITS,
                        // convert DOMHighResTimeStamp to unix timestamp
                        // https://developer.mozilla.org/en-US/docs/Web/API/DOMHighResTimeStamp#Value
                        time: Math.round(startTimestamp + entry.responseEnd),
                        duration: Math.round(durationExchange),
                        context: {
                            url: entry.name,
                            size: entry.transferSize,
                            gzip: entry.transferSize > 0 ? (entry.decodedBodySize - entry.encodedBodySize > 0 ? true : false) : null
                        }
                    };
                }

            }
        }

        for (var domain in pointMapping) {
            var pointDNS = pointMapping[domain][TYPE_DNS],
                pointExchange = pointMapping[domain][TYPE_EXCHANGE];

            // if cached, there is not dns lookup time cost.
            pointDNS.duration && timepot.mark(TYPE_DNS + domain, pointDNS);
            
            timepot.mark(TYPE_EXCHANGE + domain, pointExchange);
        }
        
    };

    /**
     * performance audits
     */
    timepot.audits = function() {
        auditsPerformanceTiming();
        auditsPerformanceEntries();
    };

    /**
     * Get timing data by group
     */
    timepot.getGroup = function(group) {
        return gGroupTimepot[group] || {};
    };

    timepot.getDefault = function() {
        return timepot.getGroup(timepot.GROUP_DEFAULT);
    };

    timepot.getPerfomance = function () {
        return timepot.getGroup(timepot.GROUP_PERFORMANCE);
    };

    timepot.getAudits = function() {
        return timepot.getGroup(timepot.GROUP_AUDITS);
    };

    /**
     * Output data in console
     */
    timepot.console = function() {
        for (var group in gGroupTimepot) {
            console.table(gGroupTimepot[group], ['group', 'name', 'time', 'duration']);
        }
    };

    /**
     * report timing data
     * @param {String} url
     * @param {Object} data
     * @param {Object} options
     */
    timepot.report = function(url, data, options) {
        var now = getCurrentMsTime(),
            reportDelayTime,
            config = timepot.config,
            length = timepot.length,
            deltaTime = now - gLastReportTime;

        !options && (options = {});

        reportDelayTime = 'reportDelayTime' in options ? options.reportDelayTime : config.reportDelayTime;
        reportCountThreshold = 'reportCountThreshold' in options ? options.reportCountThreshold : config.reportCountThreshold;

        // 实时、延时触发一次上报
        if (
            // reportDelayTime === 0 ||
            // length >= reportCountThreshold ||
            deltaTime >= reportDelayTime
        ) {
            // var data = timepot.splice(0, Math.min(length, reportCountThreshold));
            // @todo data handler AOP

            clearTimeout(gTimerRunReport);
            gLastReportTime = now;

            sendBeacon(url, data, {
                enableSendBeacon: 'enableSendBeacon' in options ? options.enableSendBeacon : config.enableSendBeacon
            });
        } else {
            clearTimeout(gTimerRunReport);

            gTimerRunReport = setTimeout(() => {
                timepot.report(url, data, options);
            }, Math.max(0, reportDelayTime - deltaTime));
        }

        /*
        // https://developers.google.com/web/fundamentals/performance/navigation-and-resource-timing
        window.addEventListener("unload", function() {
            // Caution: If you have a _lot_ of performance entries, don't send _everything_ via getEntries. This is just an example.
            let rumData = new FormData();
            rumData.append("entries", JSON.stringify(performance.getEntries()));

            // Queue beacon request and inspect for failure
            if(!navigator.sendBeacon("/phone-home", rumData)) {
                // Recover here (XHR or fetch maybe)
            }
        }, false);
        */
    };

    /**
     * start
     */
    timepot.start = function(group) {
        timepot.mark('start', { group: group });
    };

    /**
     * tick
     */
    timepot.tick = function(group) {
        !(group in gTickIndexMapping) && (gTickIndexMapping[group] = -1);
        timepot.mark('tick' + (++gTickIndexMapping[group]), { group: group });
    };

    /**
     * stop
     */
    timepot.stop = function(group) {
        timepot.mark('stop', { group: group} );
    };

    /**
     * Load time marker data before timepot initialized.
     * @todo not supported
     */
    /*
    timepot.load = function(data) {
        if (isArray(data)) {
            for(var i=data.length; i>=0; i--) {
                timepot.mark(data[i].name||'', data[i]);  // @todo unshift
                // timepot.unshift(data[i]);
            }
        }
    };
    */

    /**
     * clear timepot data
     */
    timepot.clear = function() {
        timepot = [];
        gGroupTimepot = {};
        gTimerRunReport = null;
        gTickIndexMapping = {};
    };

    // entrace
    init();

    return timepot;
})();
