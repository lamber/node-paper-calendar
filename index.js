require('dotenv').config();
var express = require('express');
var bodyParser = require("body-parser");
var fs = require('fs');
var app = express();
var canvas = require('canvas');
var solarLunar = require('solarlunar');
var request = require('request')

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let w1DeviceFile     = null;
let w1DeviceDir      = "/sys/bus/w1/devices/";

if (process.env.W1_DEVICE) {
    w1DeviceFile = process.env.W1_DEVICE;
} else {
    if (fs.existsSync(w1DeviceDir)) {
        fs.readdirSync(w1DeviceDir).forEach(function (name) {
            if (name.indexOf('28-') === 0) {
                w1DeviceFile = w1DeviceDir + name + '/w1_slave';
            }
        });
    }
}

if (!w1DeviceFile) {
    console.log('No 1-wired device found, local report disabled.');
}

var config = {
    servicePort: process.env.SERIVCE_PORT || 3000,
    dataDir: process.env.DATA_DIR || 'data',
    backupValuesFile: process.env.BACKUP_VALUES_FILE || 'data/values.json',
    backupChangesFile: process.env.BACKUP_CHANGES_FILE || 'data/changes.json',
    backupInterval: process.env.BACKUP_INTERVAL || 60000,
    changesLimit: process.env.CHANGES_LIMIT || 8640,
    tempKey: process.env.TEMP_KEY || 'temp',
    weatherLocation: process.env.WEATHER_LOCATION,
    weatherKey: process.env.WEATHER_KEY
};

var valuesMap = {

};

var changesMap = {

};

var daily = {
    dir: null,
    key: null,
    changes: {

    }
};

var weatherData = [];

if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir);
}

if (fs.existsSync(config.backupValuesFile)) {
    valuesMap = JSON.parse(fs.readFileSync(config.backupValuesFile));
}

if (fs.existsSync(config.backupChangesFile)) {
    changesMap = JSON.parse(fs.readFileSync(config.backupChangesFile));
}

initRotate();

app.post('/set', function (req, res) {
    for (let i in req.body) {
        valuesMap[i] = {
            value: req.body[i],
            updated: (new Date()).getTime()
        };
        process.nextTick(function () {
            addChange(i);
        });
    }
    res.send({
        result: 'success'
    });
});

app.get('/get/:key', function (req, res) {
    let key = req.params.key;
    if (key in valuesMap) {
        res.send(valuesMap[key]);
    } else {
        res.send({
            value: null
        });
    }
});

app.get('/today/:key', function (req, res) {
    let key = req.params.key;
    if (key in daily.changes) {
        res.send({
            changes: daily.changes[key]
        });
    } else {
        res.send({
            changes: []
        });
    }
});

app.get('/changes/:key', function (req, res) {
    let key = req.params.key;
    if (key in changesMap) {
        res.send({
            changes: changesMap[key]
        });
    } else {
        res.send({
            changes: []
        });
    }
});

app.get('/calendar', function (req, res) {
    let width  = 600;
    let height = 384;
    let redLayer = req.query.red && parseInt(req.query.red) > 0;
    if (req.query.width && req.query.width > 0) {
        width = parseInt(req.query.width);
    }
    if (req.query.height && req.query.height > 0) {
        height = parseInt(req.query.height);
    }
    
    let cvs = canvas.createCanvas(width, height);
    let ctx = cvs.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    let cvsCalendar = drawCalendar(Math.floor(width / 3 * 2), Math.floor(height / 4 * 3));
    ctx.drawImage(cvsCalendar, Math.floor(width / 3), 0);
    if (!redLayer) {
        let cvsTemps = drawChanges(width, Math.floor(height / 4), config.tempKey, function (cur, min, max) {
            return '温度：' + (cur / 1000).toFixed(1) + '℃，过去24小时：' + (min / 1000).toFixed(1) + ' - ' + (max / 1000).toFixed(1) + '℃';
        });
        let cvsForecast = drawWeatherForecast(width / 3, height / 4 * 3);
        ctx.drawImage(cvsTemps, 0, Math.floor(height / 4 * 3));
        ctx.drawImage(cvsForecast, 0, 0);
    }
    

    let img = cvs.toBuffer('image/jpeg', {quality: 1});
    res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': img.length
    });
    res.end(img); 
});

function drawCalendar(width, height){
    let cvs = canvas.createCanvas(width, height);
    let ctx = cvs.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';

    initContext2d(ctx);

    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'middle';
    let date = new Date();
    let dayX = 0;
    let dayY = 0;
    let dayHeight = Math.floor(height / 4 * 3);
    let dayWidth  = Math.floor(width);
    let dayText = date.getDate();
    let dayFont = ctx.getPropertySingleLineFont(dayText, 400, 20, null, dayWidth - 16, dayHeight - 16);
    ctx.font = dayFont.font;
    ctx.fillText(dayText, Math.floor(dayX + dayWidth / 2), Math.floor(dayY + dayHeight / 2) + dayFont.offsetY);

    let lunarX = 0;
    let lunarY = Math.floor(height / 4 * 3);
    let lunarWidth = Math.floor((width - lunarX) * 2 / 3);
    let lunarHeight = Math.floor(height / 4);
    let lunarInfo = solarLunar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
    let lunarText = lunarInfo.monthCn + lunarInfo.dayCn;
    let lunarFont = ctx.getPropertySingleLineFont(lunarText, 100, 12, null, lunarWidth - 16, lunarHeight - 16);
    ctx.font = lunarFont.font;
    ctx.fillText(lunarText, Math.floor(lunarX + lunarWidth / 2), Math.floor(lunarY + lunarHeight / 2 + lunarFont.offsetY));

    let monthX = lunarX + lunarWidth;
    let monthY = lunarY;
    let monthWidth = Math.floor(lunarWidth / 2);
    let monthHeight = Math.floor(lunarHeight / 2);
    let monthText = date.getFullYear() + '年' + (date.getMonth() + 1) + '月';
    let monthFont = ctx.getPropertySingleLineFont(monthText, 100, 12, null, monthWidth - 16, monthHeight - 16);
    ctx.font = monthFont.font;
    ctx.fillText(monthText, Math.floor(monthX + monthWidth / 2), Math.floor(monthY + monthHeight / 2 + monthFont.offsetY));

    let weekX = lunarX + lunarWidth;
    let weekY = lunarY + monthHeight;
    let weekWidth = Math.floor(lunarWidth / 2);
    let weekHeight = Math.floor(lunarHeight / 2);
    let weekText = lunarInfo.ncWeek;
    let weekFont = ctx.getPropertySingleLineFont(weekText, 100, 12, null, weekWidth - 16, weekHeight - 16);
    ctx.font = weekFont.font;
    ctx.fillRect(weekX, weekY, weekWidth, weekHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(weekText, Math.floor(weekX + weekWidth / 2), Math.floor(weekY + weekHeight / 2 + weekFont.offsetY));

    return cvs;
}

function drawChanges(width, height, key, showText){
    let datas = [];
    if (key in changesMap) {
        datas = changesMap[key];
    }
    let cvs = canvas.createCanvas(width, height);
    let ctx = cvs.getContext('2d');
    let calcValues = [];
    let pixWidth = 1, pixHeight = 1;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#000000';
    ctx.beginPath();

    let numberDatas = [];

    for (let i = 0; i < datas.length; i ++) {
        if (isNaN(datas[i].value)) {
            continue;
        }
        numberDatas.push(parseFloat(datas[i].value));
    }

    if (numberDatas.length <= 1) {
        ctx.moveTo(0, Math.floor(height / 2));
        ctx.lineTo(width - 1, Math.floor(height / 2));
    } else {
        if (width > numberDatas.length) {
            pixWidth = Math.floor(width / numberDatas.length);
            calcValues = numberDatas;
        } else {
            let valsPerPix = Math.floor(numberDatas.length / width);
            let cx = 0;
            while (cx < width) {
                let subGroup = numberDatas.slice(cx * valsPerPix, cx * valsPerPix + valsPerPix);
                if (subGroup.length > 0) {
                    calcValues.push(Math.round(subGroup.reduce((a, b) => a + b) / subGroup.length));
                }
                cx ++;
            }
        }
        let minValue = Math.min(...calcValues);
        let maxValue = Math.max(...calcValues);
        
        if (minValue == maxValue) {
            ctx.moveTo(0, Math.floor(height / 2));
            ctx.lineTo(width - 1, Math.floor(height / 2));
        } else {
            let scaleY = height / (maxValue - minValue);
            for (let i = 0; i < calcValues.length; i ++) {
                ctx.lineTo(pixWidth * i, Math.floor(scaleY * (maxValue - calcValues[i])));
            }
        }
        ctx.stroke();

        if (showText) {
            let text = showText(numberDatas[numberDatas.length - 1], Math.min(...numberDatas), Math.max(...numberDatas))
            ctx.font = 'bold 20px serif';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, 6, height - 6);
            ctx.fillText(text, 2, height - 2);
            ctx.fillStyle = '#000000';
            ctx.fillText(text, 4, height - 4);
        }
    }
    return cvs;
}

function drawWeatherForecast(width, height){

    let cvs = canvas.createCanvas(width, height);
    let ctx = cvs.getContext('2d');

    initContext2d(ctx);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.beginPath();
    ctx.moveTo(0, Math.floor(height / 3));
    ctx.lineTo(width - 1, Math.floor(height / 3));
    ctx.moveTo(0, Math.floor(height / 3 * 2));
    ctx.lineTo(width - 1, Math.floor(height / 3 * 2));
    ctx.stroke();

    ctx.fillStyle = '#000000';
    let rowHeight = Math.floor(height / 3);
    let labelHeight = Math.floor(rowHeight / 3);
    let labelWidth = labelHeight * 2;
    
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'middle';

    let labelFont = ctx.getPropertySingleLineFont('今天', null, null, null, labelWidth - 16, labelHeight - 16);

    ctx.fillRect(0, 0, labelWidth, labelHeight);
    ctx.fillRect(0, rowHeight, labelWidth, labelHeight);
    ctx.fillRect(0, rowHeight * 2, labelWidth, labelHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = labelFont.font;
    ctx.fillText('今天', labelWidth / 2, labelHeight / 2 + labelFont.offsetY);
    ctx.fillText('明天', labelWidth / 2, labelHeight / 2 + labelFont.offsetY + rowHeight);
    ctx.fillText('后天', labelWidth / 2, labelHeight / 2 + labelFont.offsetY + rowHeight * 2);

    ctx.fillStyle = '#000000';

    if (weatherData.length) {
        weatherData.forEach(function (day, index) {
            let tmpText = day.tmp_min + ' ~ ' + day.tmp_max + '℃';
            let tmpX = labelWidth;
            let tmpY = index * rowHeight;
            let tmpWidth = width - tmpX;
            let tmpHeight = labelHeight;
            let tmpFont = ctx.getPropertySingleLineFont(tmpText, null, null, null, tmpWidth - 16, tmpHeight - 16);
            ctx.font = tmpFont.font;
            ctx.fillText(tmpText, tmpX + tmpWidth / 2, tmpY + tmpHeight / 2 + tmpFont.offsetY);

            let condText = day.cond_txt_d + ' / ' + day.cond_txt_n;
            let condX = 0;
            let condY = index * rowHeight + tmpHeight;
            let condWidth = width;
            let condHeight = labelHeight;
            let condFont = ctx.getPropertySingleLineFont(condText, null, null, null, condWidth - 16, condHeight - 16);
            ctx.font = condFont.font;
            ctx.fillText(condText, condX + condWidth / 2, condY + condHeight / 2 + condFont.offsetY);

            let sunText = '日出 ' + day.sr + ' 日落 ' + day.ss;
            let sunX = 0;
            let sunY = index * rowHeight + tmpHeight + condHeight;
            let sunWidth = width;
            let sunHeight = labelHeight;
            let sunFont = ctx.getPropertySingleLineFont(sunText, null, null, null, sunWidth - 16, sunHeight - 16);
            ctx.font = sunFont.font;
            ctx.fillText(sunText, sunX + sunWidth / 2, sunY + sunHeight / 2 + sunFont.offsetY);
        });
    }

    return cvs;

}

app.listen(config.servicePort, function () {
    console.log('Listening on port ' + config.servicePort);
});

function getWeatherForecastData(){
    if (!config.tempKey) {
        console.log('No Weather Key');
        return;
    }
    let url = 'https://free-api.heweather.net/s6/weather/forecast?location=' + config.weatherLocation + '&key=' + config.weatherKey;

    request.get(url, function (err, data) {
        console.log(new Date().toString())
        if (err) {
            console.log('Get Weather Data Failed:' + err);
            setTimeout(getWeatherForecastData, 60000);
            return;
        }
        try {
            let fcData = JSON.parse(data.body);
            if (fcData.HeWeather6 && fcData.HeWeather6.length && fcData.HeWeather6[0].daily_forecast) {
                weatherData = fcData.HeWeather6[0].daily_forecast;
                console.log('Weather data refreshed.');
            } else {
                console.log('Weather data format unexpected.');
                console.log(data.body);
            }
        } catch(e) {
            console.log('Weather data parsing error.');
            console.log(data.body);
        }
        setTimeout(getWeatherForecastData, 900000);        
    })
}

function initContext2d(ctx){
    ctx.getPropertySingleLineFont = function (text, max, min, font, width, height) {
        font = font || 'Impact'
        max = max || 40;
        min = min || 12;
        var lastFont = this.font;
        var fontSize = max;
        this.font = fontSize + 'px ' + font;
        var metrics = this.measureText(text);
        while (metrics.width > width || metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > height) {
            fontSize -= 1;
            if (fontSize < min) {
                this.font = lastFont;
                return {
                    font: min + 'px ' + font,
                    offsetY: Math.floor((metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2),
                    width: metrics.width
                };
            }
            this.font = fontSize + 'px ' + font;
            metrics = this.measureText(text);
        }
        this.font = lastFont;
        return {
            font: fontSize + 'px ' + font,
            offsetY: Math.floor((metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2),
            width: metrics.width
        };
    }
}

function addChange(key){
    if (!(key in changesMap)) {
        changesMap[key] = [];
    } else {
        if (changesMap[key].length >= config.changesLimit) {
            changesMap[key].splice(0, changesMap[key].length - config.changesLimit + 1);
        }
    }
    changesMap[key].push(valuesMap[key]);
    checkRotate();
    if (!(key in daily.changes)) {
        daily.changes[key] = [];
    }
    daily.changes[key].push(valuesMap[key]);
}

function getDailyKey() {
    let d = new Date();
    function pad(x) {
        return (x > 9 ? '' : '0') + x;
    }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function checkRotate(){
    let curKey = getDailyKey();
    if (curKey != daily.key) {
        backupDaily();
        daily.dir = config.dataDir + '/' + curKey;
        daily.key = curKey;
        daily.changes = {};
        loadRotateIfExists();
    }
}

function initRotate(){
    let curKey = getDailyKey();
    daily.dir = config.dataDir + '/' + curKey + '/';
    daily.key = curKey;
    loadRotateIfExists();
}

function loadRotateIfExists(){
    if (!fs.existsSync(daily.dir)) {
        fs.mkdirSync(daily.dir);
        return false;
    }
    fs.readdirSync(daily.dir).forEach(function (name) {
        let segs = name.split('.');
        daily.changes[segs[0]] = JSON.parse(fs.readFileSync(daily.dir + name));
    });
    return true;
}

function backupDaily(){
    if (!fs.existsSync(daily.dir)) {
        fs.mkdirSync(daily.dir);
    }
    for (let key in daily.changes) {
        fs.writeFileSync(daily.dir + key + '.json', JSON.stringify(daily.changes[key]));
    }
}

function backupRuntime(){
    fs.writeFileSync(config.backupValuesFile, JSON.stringify(valuesMap));
    fs.writeFileSync(config.backupChangesFile, JSON.stringify(changesMap));
}

function quickBackup(){
    fs.writeFile(
        config.backupValuesFile, 
        JSON.stringify(valuesMap), 
        function (err1) {
            if (err1) {
                console.log('Backup values failed:' + err1);
            }
            fs.writeFile(
                config.backupChangesFile,
                JSON.stringify(changesMap),
                function (err2) {
                    if (err2) {
                        console.log('Backup values failed:' + err2);
                    }
                    setTimeout(quickBackup, config.backupInterval);
                } 
            )
        }
    );
}

function reportTemp () {
    let timeStart = new Date().getTime();
    let fileContent = fs.readFileSync(w1DeviceFile).toString();
    let temp = fileContent.match(/t=(\d+)/)[1];
    console.log('Temp reading cost: ' + (new Date().getTime() - timeStart) + 'ms');
    timeStart = new Date().getTime();
    console.log('Temp read at ' + new Date().toString())
    valuesMap[config.tempKey] = {
        value: parseInt(temp),
        updated: (new Date()).getTime()
    };
    process.nextTick(function () {
        addChange(config.tempKey);
    });
    setTimeout(reportTemp, 10000);
}

setTimeout(quickBackup, config.backupInterval);
getWeatherForecastData();
if (w1DeviceFile) {
    reportTemp();
}

process.on('SIGINT', (code) => {
    backupRuntime();
    backupDaily();
    console.log('Process exit.')
    process.exit('SIGINT');
});