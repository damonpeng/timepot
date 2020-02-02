/**
 * 
 */
(function() {
    // Essentially, a timepot is an array of time points with multiple custom attributes and methods.
    var timepot,
        gGroupTimepot = {},
        gTimerRunReport = null,
        gLastReportTime;

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

   // @todo https://developers.google.com/web/updates/2018/07/reportingobserver

    /**
     * check if is array.
     * @param {Array} arrayLike 
     */
    var isArray = function(arrayLike) {
        return Object.prototype.toString.call(arrayLike) === '[object Array]';
    };

    /**
     * Get current time in ms.
     */
    var getCurrentMsTime = function() {
        return Date.now();
    };

    /**
     * Get performance timing api
     */
    var getTimingAPI = function() {
        return (window.performance || window.msPerformance || window.webkitPerformance || {}).timing;
    };

    /**
     * Send data to server
     * @param {String}          url     Optional
     * @param {Object|String}   data    Optional
     * @param {Object}          options Optional, options.ENABLE_SEND_BEACON indicate whether navigator.sendBeacon enabled.
     */
    var sendBeacon = function(url, data, options) {
        var formattedData = data;
        
        if (options.ENABLE_SEND_BEACON && 'sendBeacon' in navigator) {
            if (data && typeof data !== 'string' && (typeof Blob === 'undefined' || data instanceof Blob===false)) {
                // formattedData = new Blob([JSON.stringify(data)], {type: 'application/json'});

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

                formattedData = new Blob([JSON.stringify(data)], {type: 'application/x-www-form-urlencoded'});
            }

            return navigator.sendBeacon(url, formattedData);
        } else {
            // fallback to XHR
            var xhr;
            
            xhr = typeof XMLHttpRequest !=='undefined' ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
            xhr.open('POST', url, true);
            xhr.withCredentials = true;

            if (typeof data === 'string') {
                xhr.setRequestHeader('Content-Type', 'text/plain; charset=utf-8');
            } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
                data.type && xhr.setRequestHeader('Content-Type', data.type);
            } else if (data && typeof data === 'object') {
                xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
                formattedData = JSON.stringify(data);
            }

            try {
                xhr.send(formattedData);
            } catch (error) {
                return false;
            }

            return true;
        }
    }

    // preset group name
    timepot.GROUP_DEFAULT = 'default';
    timepot.GROUP_PERFORMANCE = 'performance';
    timepot.GROUP_AUDITS = 'audits';

    

    // global config
    timepot.config = {
        NAMESPACE: 'timepot',   // global name space
        ENABLE_PERFORMANCE: true,   //  if need performance data
        ENABLE_SEND_BEACON: true,        // enable report data to server through navigator.sendBeacon
        QUEUE_DELAY_LENGTH : 10,
        QUEUE_DELAY_TIME: 200,   // ms
        QUEUE_SEND_MAX_COUNT: 10,   // maxium send count
    };

    /**
     * initialize
     */
    timepot.init = function() {
        // load data of fake timepot
        if (timepot.length > 0) {
            for (var i=0, l=timepot.length; i<l; i++) {
                var group = timepot[i].group || timepot.GROUP_DEFAULT;
                !gGroupTimepot[group] && (gGroupTimepot[group] = []);
                gGroupTimepot[group].push(timepot[i]);
            }
        }

        gLastReportTime = getCurrentMsTime();
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

            if (timepot.config.ENABLE_PERFORMANCE) {
                // waiting for loading finished to get complete data
                if (document.readyState === 'complete') {
                    timepot.performance();
                    timepot.audits();
                } else {
                    isNeedWaiting = true;
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

            !isNeedWaiting && resolved(gGroupTimepot);
        });
    };

    /**
     * Get performance data
     */
    timepot.performance = function() {
        var timing = getTimingAPI();

        if (! timing) {
            return false;
        }

        // performance.timing raw data
        if (gGroupTimepot[timepot.GROUP_PERFORMANCE]) {
            return false;
        }
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
     * performance audits
     */
    timepot.audits = function() {
        var timing = getTimingAPI(), group = timepot.GROUP_AUDITS;

        if (! timing) {
            return false;
        }

        if (! gGroupTimepot[group]) {
            // https://w3c.github.io/navigation-timing/#processing-model

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

            timepot.mark('transmission', {
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

            timepot.mark('total', {
                group: group,
                time: timing.loadEventEnd,
                duration: timing.loadEventEnd - timing.navigationStart
            });
        }

        return true;
    };

        // timepot.getResourceTiming = 
        // @todo performance.getEntries() 展示最耗费时间的资源


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

    timepot.report = function(url, options) {
        var now = getCurrentMsTime(),
            config = timepot.config,
            length = timepot.length,
            deltaTime = now - gLastReportTime;

        !options && (options = {});

        // 实时、累积条数或时间，哪个先到都能触发一次上报
        if (
            options.delay === 0 ||
            length >= config.QUEUE_DELAY_LENGTH || deltaTime >= config.QUEUE_DELAY_TIME
        ) {
            var data = timepot.splice(0, Math.min(length, config.QUEUE_SEND_MAX_COUNT));

            // @todo data handler AOP

            clearTimeout(gTimerRunReport);
            gLastReportTime = now;

            sendBeacon(url, data, {
                ENABLE_SEND_BEACON: config.ENABLE_SEND_BEACON
            });
        } else {
            clearTimeout(gTimerRunReport);

            gTimerRunReport = setTimeout(() => {
                timepot.report();
            }, config.QUEUE_DELAY_TIME - deltaTime);
        }
    };

    timepot.getMarkByName = function(name, group) {

    };

    timepot.measure = function(name, startMark, endMark, group) {
        var result;

        if (typeof startMark === 'string') {
            result = timepot.getMarkByName(endMark, group).time - timepot.getMarkByName(startMark, group).time
        } else {
            result = endMark.time - startMark.time;
        }

        // result = timepot

        return result;
    };

    timepot.save = function(storage) {
        
    };

    timepot.restore = function(storage) {
        
    };

    /**
     * t0 time
     */
    timepot.start = function(group) {
        timepot.mark('start', { group: group} );
    };

    /**
     * end this statistics
     */
    timepot.stop = function(group) {
        timepot.mark('stop', { group: group} );
    };

    /**
     * Load time marker data before timepot initialized.
     */
    timepot.load = function(data) {
        if (isArray(data)) {
            for(var i=data.length; i>=0; i--) {
                timepot.unshift(data[i]);
            }
        }
    };

    /**
     * clear timepot data
     */
    timepot.clear = function(point) {
        timepot = [];
        gGroupTimepot = {};
        gTimerRunReport = null;
    };

    // entrace
    timepot.init();

    return timepot;
})();
