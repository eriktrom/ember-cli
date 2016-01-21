'use strict';

var assign      = require('lodash/assign');
var path        = require('path');
var Command     = require('../models/command');
var Promise     = require('../ext/promise');
var SilentError = require('silent-error');
var PortFinder  = require('portfinder');
var win         = require('../utilities/windows-admin');
var EOL         = require('os').EOL;

PortFinder.basePort = 49152;

var getPort = Promise.denodeify(PortFinder.getPort);
var defaultPort = process.env.PORT || 4200;

module.exports = Command.extend({
  name: 'serve',
  description: 'Builds and serves your app, rebuilding on file changes.',
  aliases: ['server', 's'],

  availableOptions: [
    { name: 'port',             type: Number,  default: defaultPort,   aliases: ['p'] },
    { name: 'host',             type: String,                          aliases: ['H'],     description: 'Listens on all interfaces by default' },
    { name: 'proxy',            type: String,                          aliases: ['pr', 'pxy'] },
    { name: 'insecure-proxy',   type: Boolean, default: false,         aliases: ['inspr'], description: 'Set false to proxy self-signed SSL certificates' },
    { name: 'watcher',          type: String,  default: 'events',      aliases: ['w'] },
    { name: 'live-reload',      type: Boolean, default: true,          aliases: ['lr'] },
    { name: 'live-reload-host', type: String,                          aliases: ['lrh'],   description: 'Defaults to host' },
    { name: 'live-reload-base-url', type: String, description: 'Defaults to baseURL', aliases: ['lrbu'] },
    { name: 'live-reload-port', type: Number,                          aliases: ['lrp'],   description: '(Defaults to port number within [49152...65535])' },
    { name: 'environment',      type: String,  default: 'development', aliases: ['e', { 'dev': 'development' }, { 'prod': 'production' }] },
    { name: 'output-path',      type: path,    default: 'dist/',       aliases: ['op', 'out'] },
    { name: 'ssl',              type: Boolean, default: false },
    { name: 'ssl-key',          type: String,  default: 'ssl/server.key' },
    { name: 'ssl-cert',         type: String,  default: 'ssl/server.crt' }
  ],

  run: function(commandOptions) {
    var port = commandOptions.port ? Promise.resolve(commandOptions.port) : getPort({ host: commandOptions.host });
    var liveReloadHost = commandOptions.liveReloadHost || commandOptions.host;
    var liveReloadPort = ensurePort({ port: commandOptions.liveReloadPort, host: liveReloadHost });

    return Promise.all([liveReloadPort, port]).then(function(values) {
      var liveReloadPort = values[0];
      var port = values[1];
      commandOptions = assign({}, commandOptions, {
        port: port,
        liveReloadPort: liveReloadPort,
        liveReloadHost: liveReloadHost,
        baseURL: this.project.config(commandOptions.environment).baseURL || '/'
      });

      if (commandOptions.proxy) {
        if (!commandOptions.proxy.match(/^(http:|https:)/)) {
          var message = 'You need to include a protocol with the proxy URL.' + EOL + 'Try --proxy http://' + commandOptions.proxy;

          return Promise.reject(new SilentError(message));
        }
      }

      var ServeTask = this.tasks.Serve;
      var serve = new ServeTask({
        ui: this.ui,
        analytics: this.analytics,
        project: this.project
      });

      return win.checkWindowsElevation(this.ui).then(function() {
        return serve.run(commandOptions);
      });
    }.bind(this));

    /*
    manual tests: (remove me when real ones exist)

    Test 1:
      python -m SimpleHTTPServer 8005
      ember serve ember serve -lrp 8005 -lrh 0.0.0.0
      Then live reload should use port 49152

    Test 2:
      Given in etc/hosts i add
        ::1        machost-a.local
        127.0.0.1  machost-b.local
        0.0.0.0    machost-c.local

      When I run any of the following
        ember serve -lrp 8005 -lrh machost-a.local
        ember serve -lrp 8005 -lrh machost-b.local
        ember serve -lrp 8005 -lrh machost-c.local

      Then for all cases live reload should use port 8006
      (8006 in this case becomes new PortFinder.basePort which cant be changed afaik atm)

    Test 3:
      Turn off python server
      run ember serve
      expect port eq 49152

    Test 4:
      python -m SimpleHTTPServer 49152
      ember serve -lrh 0.0.0.0
      expect live reload port is 49153

    HELP!: any suggestions on how to write these tests for real? it seems starting
    a net.createServer instance would work. yell if bad idea.
     */
    function ensurePort(options) {
      options.host = options.host || '::1';

      var portTestResults = [],
          hosts = [options.host, '0.0.0.0', '127.0.0.1'];

      // remove duplicate host arg if already in hosts array
      for (var i = 0; i < hosts.length; i++) {
        if (options.host === hosts[i]) { hosts.shift(); }
      }

      // check port
      for (var j = 0; j < hosts.length; j++) {
        // note this resets the base port to options.port, if not undefined
        portTestResults.push(getPort({ host: hosts[j], port: options.port }));
      }

      // check all ports the same, if not, recurse, else return good port
      return Promise.all(portTestResults).then(function(ports) {
        var port = ports.pop();
        for (var i = 0; i < ports.length; i++) {
          if (port !== ports[i]) { return ensurePort({ host: options.hosts }); }
        }

        return port;
      });
    }

  }
});
