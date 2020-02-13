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
        gIsStopReport = false,
        gIsUnloadReportBind = false,
        gTickIndexMapping = {},
        REPORT_FROM_UNLOAD = 'unload',
        REPORT_FROM_POLLING = 'polling';

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
        context: {},
        reported: Boolean
    }
    */

    /**
     * Check if is array.
     * @param {Array} arrayLike 
     */
    var isArray = function(arrayLike) {
        return Object.prototype.toString.call(arrayLike) === '[object Array]';
    };

    /**
     * Check if input empty. from https://stackoverflow.com/a/4994244/12849462
     * @param {Object} obj 
     */
    var isEmpty = function (obj) {
        // null and undefined are "empty"
        if (obj == null) return true;

        // Assume if it has a length property with a non-zero value
        // that that property is correct.
        if (obj.length > 0)    return false;
        if (obj.length === 0)  return true;

        // If it isn't an object at this point
        // it is empty, but it can't be anything *but* empty
        // Is it empty?  Depends on your application.
        if (typeof obj !== "object") return true;

        // Otherwise, does it have any properties of its own?
        // Note that this doesn't handle
        // toString and valueOf enumeration bugs in IE < 9
        for (var key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) return false;
        }

        return true;
    }

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
     * @param {Object}          options Optional, 
     *                                  options.enableSendBeacon indicate whether navigator.sendBeacon enabled.
     *                                  options.enableFetch indicate whether fetch enabled.
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
        
        if (options.enableSendBeacon && ('sendBeacon' in navigator)) {
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
        } else if (options.enableFetch && ('fetch' in window)) {
            /*
            var isSameOrigin = true,
                originMatches;

            originMatches = url.match(/^(https?:)?\/\/([^/]*)/);

            if (originMatches && originMatches.length > 2) {
                var isSameProtocol, isSameHost;

                isSameProtocol = !originMatches[1] || originMatches[1] === location.protocol ? true : false;
                isSameHost = originMatches[2] && originMatches[2] === location.host ? true : false; 

                isSameOrigin = isSameProtocol && isSameHost ? true : false;
            }
            */

            // fallback to fetch
            fetch(url, {
                method: 'POST',
                mode: 'no-cors',
                credentials: 'include',
                // https://developer.mozilla.org/en-US/docs/Web/API/Request/cache
                cache: 'no-store',
                // https://fetch.spec.whatwg.org/#requests
                // This can be used to allow the request to outlive the environment settings object,
                //  e.g., navigator.sendBeacon and the HTML img element set this flag. 
                // Requests with this flag set are subject to additional processing requirements.
                keepalive: true,
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
        // namespace: 'timepot',   // global name space
        enablePerformance: true,    //  if need performance data
        enableSendBeacon: true,     // enable report data to server through navigator.sendBeacon
        enableFetch: true,          // enable report data to server through fetch
        reportPollingTime: 1000     // ms
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
     * Start
     */
    timepot.start = function(group) {
        timepot.mark('start', { group: group });
    };

    /**
     * Tick
     */
    timepot.tick = function(group) {
        !(group in gTickIndexMapping) && (gTickIndexMapping[group] = -1);
        timepot.mark('tick' + (++gTickIndexMapping[group]), { group: group });
    };

    /**
     * Stop
     */
    timepot.stop = function(group) {
        timepot.mark('stop', { group: group} );
    };

    /**
     * Performance.timing raw data
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
     * Audits for performance.timing
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
     * Audits for performance.getEntries()
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
     * Performance audits
     */
    timepot.audits = function() {
        auditsPerformanceTiming();
        auditsPerformanceEntries();
    };

    /**
     * Get pure timing data
     */
    timepot.getRawTimingData = function() {
        var data = [];

        for (var i=0, l=timepot.length; i<l; i++) {
            data.push( timepot[i] );
        }

        return data;
    };

    /**
     * Get timing data by group
     */
    timepot.getTimingGroup = function(group) {
        return gGroupTimepot[group] || {};
    };

    /**
     * Get performance group data
     */
    timepot.getPerformance = function () {
        return timepot.getTimingGroup(timepot.GROUP_PERFORMANCE);
    };

    /**
     * Get audits group data
     */
    timepot.getAudits = function() {
        return timepot.getTimingGroup(timepot.GROUP_AUDITS);
    };

    /**
     * Calculated timing data, Promised api
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

                            resolved(timepot.getRawTimingData());
                        })).observe({
                            entryTypes: ['navigation']
                        });
                    } else {
                        window.addEventListener('load', function() {
                            // should async to wait for onload event executing
                            setTimeout(function() {
                                timepot.performance();
                                timepot.audits();

                                resolved(timepot.getRawTimingData());
                            }, 0);
                        });
                    }
                }
            }

            !isNeedWaiting && (
                resolved(timepot.getRawTimingData())
            );
        });
    };

    /**
     * Formatting timing data
     */
    timepot.formatTimingDataByGroup = function(data) {
        var mapping = {};

        for (var i=0, l=data.length; i<l; i++) {
            !mapping[data[i].group] && (mapping[data[i].group] = []);
            mapping[data[i].group].push( data[i] );
        }

        return mapping;
    };

    /**
     * Report data to server
     * @param {String} url Required, remote server url
     * @param {function} dataHandler Optional, data format handler
     * @param {Object} options  options.reportPollingTime: polling to report
     *                          options.inRealtime: if need sent data in realtime
     *                          options.enableSendBeacon: if enable navigator.sendBeacon()
     *                          options.enableFetch: if enable fetch()
     *                          options.from: for identify if internal call
     * 
     */
    timepot.report = function(url, dataHandler, options) {
        var now = getCurrentMsTime(),
            reportPollingTime,
            config = timepot.config,
            deltaTime = now - gLastReportTime;

        !options && (options = {});
        !dataHandler && (dataHandler = function(data) { return data; });

        if (options.from && options.from!==REPORT_FROM_POLLING && options.from!==REPORT_FROM_UNLOAD) {
            gIsStopReport = false;
        }

        if (gIsStopReport) {
            return;
        }

        reportPollingTime = 'reportPollingTime' in options ? options.reportPollingTime : config.reportPollingTime;

        // report in real time, or meet polling waiting time
        if (
            options.inRealtime
            ||
            deltaTime >= reportPollingTime
        ) {
            var reportData,
                unreportData = [];

            gLastReportTime = now;

            // get only unreported data
            for (var i=0, l=timepot.length; i<l; i++) {
                !timepot[i].reported && (
                    unreportData.push(timepot[i])
                );
            }

            reportData = dataHandler(unreportData);

            if (! isEmpty(reportData)) {
                sendBeacon(url, reportData, {
                    enableSendBeacon: 'enableSendBeacon' in options ? options.enableSendBeacon : config.enableSendBeacon,
                    enableFetch: 'enableFetch' in options ? options.enableFetch : config.enableFetch
                });
            }

            // set data as reported
            for (var i=0, l=unreportData.length; i<l; i++) {
                unreportData[i].reported = true;
            }

            // continue polling
            options.from!==REPORT_FROM_UNLOAD && timepot.report(url, dataHandler, options);
        } else {
            clearTimeout(gTimerRunReport);

            gTimerRunReport = setTimeout(() => {
                options.from = 'polling';
                timepot.report(url, dataHandler, options);
            }, Math.max(0, reportPollingTime - deltaTime));
        }

        if (! gIsUnloadReportBind) {
            gIsUnloadReportBind = true;
        
            // https://developers.google.com/web/fundamentals/performance/navigation-and-resource-timing
            window.addEventListener('beforeunload', function() {
                options.from = 'unload';
                options.inRealtime = true;
                timepot.report(url, dataHandler, options);
            }, false);
        }
    };
    
    /**
     * Stop report polling
     */
    timepot.stopReport = function() {
        clearTimeout(gTimerRunReport);
        gIsStopReport = true;
    };

    /**
     * Clear timepot data
     */
    timepot.clear = function() {
        timepot = [];
        gGroupTimepot = {};
        gTimerRunReport = null;
        gTickIndexMapping = {};
    };

    /**
     * Output data in console
     */
    timepot.console = function() {
        for (var group in gGroupTimepot) {
            console.table(gGroupTimepot[group], ['group', 'name', 'time', 'duration']);
        }
    };

    // entrace
    init();

    return timepot;
})();
