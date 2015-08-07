var http = require('http');
var https = require('https');
var basicAuth = require('basic-auth-connect');
var fs = require('fs');
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var Stomp = require('stompjs2');
var smb = require('stomp_msg_broker');
var StompMsgBroker = smb.StompMsgBroker;

// argv[2] is the config file
if (process.argv.length < 3) {
	console.error('config file is not optional');
	process.exit(1);
}
var config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
//console.log(JSON.stringify(config));
var restConfig = config["rest"];
if (!restConfig) {
	console.error('missing "rest" config');
	process.exit(1);
}
var protocolsConfig = restConfig["protocols"];
if (!protocolsConfig) {
	console.error('missing "protocols" config');
	process.exit(1);
}
var brokerConfig = config["msgBroker"];
if (!brokerConfig) {
	console.error('missing "msgBroker" config');
	process.exit(1);
}
app.use(bodyParser.json());

var basicAuthConfig = brokerConfig.login_options;
if (basicAuthConfig) app.use(basicAuth(basicAuthConfig.login, basicAuthConfig.passcode));
	
app.use(function timeLog(req, res, next) {
	console.log('an incomming request @ ./. Time: ', Date.now());
	res.header("Access-Control-Allow-Origin", "*");
	next();
});

var broker = new StompMsgBroker(function() {return Stomp.client(brokerConfig.url, null, brokerConfig.tlsOptions);}, brokerConfig.brokerOptions, brokerConfig.loginOptions, {});

// set up the service home route
//////////////////////////////////////////////////////////////////////////////////////
var homeRoutePath = (typeof restConfig.homeRoute === 'string' && restConfig.homeRoute.length > 0 ? restConfig.homeRoute : '/');
var router = express.Router();
router.use(function (req, res, next) {
	console.log('an incomming request @ ' + homeRoutePath + '. Time: ', Date.now());
	function retunException(e) {
		res.json({"exception":e.toString()});
	}
	try {
		res.set('Content-Type', 'application/json');
		if (req.method === 'POST') {
			var destination = req.url;
			if (destination.substr(destination.length - 1) === '/') destination = destination.substr(0, destination.length - 1);
			//console.log(req.body);
			//console.log(destination);
			var o = req.body;
			if (!o || !o.message) {
				retunException('bad request');
				return;
			}
			else {
				var timeOut = setTimeout(function() {
					retunException('timeout. unable to confirm message send');
				}, 20000);
				broker.send(destination, (o.headers ? o.headers : {}), o.message.toString(), function(recepit_id) {
					clearTimeout(timeOut);
					res.json({"recepit_id": recepit_id});
				});
			}
		}
		else {
			retunException('bad request');
		}
	} catch(e) {
		retunException(e);
	}
});
app.use(homeRoutePath, router);
//////////////////////////////////////////////////////////////////////////////////////

broker.onconnect = function() {
	var s = 'connected to the msg broker ' + broker.url;
	console.log(s);
	// HTTP
	//////////////////////////////////////////////////////////////////////////////////////
	var httpServer = null;
	if (protocolsConfig["http"]) {
		var httpConfig = protocolsConfig["http"];
		if (!httpConfig.port) {
			console.error('no http port specified');
			process.exit(1);
		}
		var httpServer = http.createServer(app);
		httpServer.listen(httpConfig.port, function() {
			var host = httpServer.address().address;
			var port = httpServer.address().port;
			console.log('service listening at %s://%s:%s', 'http', host, port);
		});
	}
	//////////////////////////////////////////////////////////////////////////////////////

	// HTTPS
	//////////////////////////////////////////////////////////////////////////////////////
	var httpsServer = null;
	if (protocolsConfig["https"]) {
		var httpsConfig = protocolsConfig["https"];
		if (!httpsConfig.port) {
			console.error('no https port specified');
			process.exit(1);
		}
		if (!httpsConfig.private_key) {
			console.error('no private key file specified');
			process.exit(1);
		}
		if (!httpsConfig.certificate) {
			console.error('no certificate file specified');
			process.exit(1);
		}	
		var options = {
			key: fs.readFileSync(httpsConfig.private_key, 'utf8'),
			cert: fs.readFileSync(httpsConfig.certificate, 'utf8')	
		};
		if (httpsConfig.ca_files && httpsConfig.ca_files.length > 0) {
			var ca = [];
			for (var i in httpsConfig.ca_files)
				ca.push(fs.readFileSync(httpsConfig.ca_files[i], 'utf8'));
			options.ca = ca;
		}
		var httpsServer = https.createServer(options, app);
		httpsServer.listen(httpsConfig.port, function() {
			var host = httpsServer.address().address;
			var port = httpsServer.address().port;
			console.log('service listening at %s://%s:%s', 'https', host, port);
		})
	}
	//////////////////////////////////////////////////////////////////////////////////////

	if (!httpServer && !httpsServer) {
		console.error('no web service to run');
		process.exit(1);
	}
};