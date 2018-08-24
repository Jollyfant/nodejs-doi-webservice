/*
 * NodeJS EIDA DOI Webservice
 *
 * Webservice that requests DOI information from FDSN
 * and exposes this information by HTTP API
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans
 * Licensed under MIT
 *
 */

"use strict";

const __VERSION__ = "1.0.0";

// Import standard lib
const fs = require("fs");
const querystring = require("querystring");
const http = require("http");
const path = require("path");
const url = require("url");

const DOIWebservice = function(configuration, callback) {

  /* class DOIWebservice
   * Class container webservice for EIDA Network DOIs
   */

  function HTTPError(response, statusCode, message) {

    /* function HTTPError
     * Writes HTTP reponse to the client
     */

    response.writeHead(statusCode, {"Content-Type": "text/plain"});
    response.write(message);
    response.end();

  }

  function EnableCORS(response) {

    /* function EnableCORS
     * Enables the cross origin headers
     */

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET");

  }

  this.configuration = configuration;
  this.logger = this.setupLogger();

  // Class global for caching DOIs
  this.cachedDOIs = new Array();

  const Server = http.createServer(function(request, response) {

    // Enable CORS headers when required
    if(this.configuration.__CORS__) {
      EnableCORS(response);
    }

    // Handle each incoming request
    var uri = url.parse(request.url);
    var initialized = Date.now();
    var requestedDOIs = new Array();

    // Write information to logfile
    response.on("finish", function() {

      // Elasticsearch
      var requestLog = {
        "timestamp": new Date().toISOString(),
        "method": request.method,
        "query": uri.query,
        "path": uri.pathname,
        "client": request.headers["x-forwarded-for"] || request.connection.remoteAddress,
        "agent": request.headers["user-agent"] || null,
        "statusCode": response.statusCode,
        "msRequestTime": (Date.now() - initialized),
        "nDOIs": requestedDOIs.length
      }

      return this.logger.write(JSON.stringify(requestLog) + "\n");

    }.bind(this));

    // Only root path is supported
    if(uri.pathname !== "/") {
      return HTTPError(response, 404, "Method not supported.");
    }

    var queryObject = querystring.parse(uri.query);

    // Check the user input
    try {
      this.validateParameters(queryObject);
    } catch(exception) {
      if(this.configuration.__DEBUG__) {
        return HTTPError(response, 400, exception.stack);
      } else {
        return HTTPError(response, 400, exception.message);
      }
    }

    // Filter the DOIs by the request
    var requestedDOIs = this.filterDOIs(queryObject);

    // Write 204
    if(requestedDOIs.length === 0) {
      return HTTPError(response, 204);
    }

    // Write 200 JSON
    response.writeHead(200, {"Content-Type": "application/json"});
    response.write(JSON.stringify(requestedDOIs));
    response.end();

  }.bind(this));

  // Get process environment variables (Docker)
  var host = process.env.SERVICE_HOST || this.configuration.HOST;
  var port = Number(process.env.SERVICE_PORT) || this.configuration.PORT;

  // Listen to incoming HTTP connections
  Server.listen(port, host, function() {
    callback(configuration.__NAME__, host, port);
  });

  // Update the DOIs in memory
  this.updateDOIs();

}

DOIWebservice.prototype.validateParameters = function(queryObject) {

  /* function DOIWebservice.validateParameters
   * Checks user parameters passed to API request
   */

  function isValidParameter(key, value) {

    /* function isValidParameter
     * Returns boolean whether parameter attributes are valid
     */

    // Network code may include year
    const NETWORK_REGEXP = new RegExp(/^([0-9a-z_?*]{1,7},){0,}([0-9a-z_?*]{1,7})$/i);

    // Check individual parameters
    switch(key) {
      case "network":
        return NETWORK_REGEXP.test(value);
      default:
        throw new Error("Invalid parameter passed.");
      }
 
  }

  const ALLOWED_PARAMETERS = [
    "network"
  ];

  // Check if all parameters are allowed
  Object.keys(queryObject).forEach(function(x) {

    // Must be supported by the service
    if(!ALLOWED_PARAMETERS.includes(x)) {
      throw new Error("Key " + x + " is not supported.");
    }

    if(!isValidParameter(x, queryObject[x])) {
      throw new Error("Key " + x + " is not valid.");
    }

  });

}

DOIWebservice.prototype.setupLogger = function() {

  /* DOIWebservice.setupLogger
   * Sets up log directory and file for logging
   */

  // Create the log directory if it does not exist
  fs.existsSync(path.join(__dirname, "logs")) || fs.mkdirSync(path.join(__dirname, "logs"));
  return fs.createWriteStream(path.join(__dirname, "logs", "service.log"), {"flags": "a"});

}


DOIWebservice.prototype.filterDOIs = function(queryObject) {

  /* function DOIWebservice.filterLatencies
   * Filters latencies from the cached object, naive and low performance
   */

  function matchArray(code, values) {

    /* function matchArray
     * Returns elements from array that match a wildcard expression
     */

    function testWildcard(code, x) {

      /* function testWildcard
       * Converts ? * wildcards to regular expressions
       */

      function convertWildcard(x) {

        /* function testWildcard
         * Converts ? * wildcards to regular expressions
         */

        return x.replace(/\?/g, ".").replace(/\*/g, ".*");

      }

      return new RegExp("^" + convertWildcard(x) + "$").test(code);

    }

    return values.filter(function(x) {
      return testWildcard(code, x);
    }).length;

  }

  if(!queryObject.network) {
    return this.cachedDOIs;
  }

  // Filter the cache with the request
  return this.cachedDOIs.filter(function(doi) {
    return matchArray(doi.network, queryObject.network.split(","));
  });

}

DOIWebservice.prototype.updateDOIs = function() {

  /* function DOIWebservice.updateDOIs
   * Queries the FDSN for network DOIs and doi.org for json-ld
   */

  function parseEntry(x) {

    /* function parseEntry
     * Parses an entry in the FDSN DOI table
     */

    var [network, doi] = x.split(",");

    return {
      "network": network,
      "doi": doi
    }

  }

  // HTML page to harvest information from 
  const FDSN_DOI_URL = "http://www.fdsn.org/networks/doi/";

  // Harvest network & DOI information from the FDSN
  this.HTTPGETWrapper(FDSN_DOI_URL, function(data) {

    // Parse the HTML response from the FDSN and get networks & DOIs
    if(data !== null) {
      this.cachedDOIs = data.split("\r\n").slice(0, -1).map(parseEntry);
    }

    // Queue for the next update
    setTimeout(this.updateDOIs.bind(this), this.configuration.REFRESH_INTERVAL_MS);

  }.bind(this));

}

DOIWebservice.prototype.HTTPGETWrapper = function(HTTPRequest, callback) {

  /* function DOIWebservice.HTTPGETWrapper
   * Wrapper for HTTP GET call
   */

  var request = http.request(HTTPRequest, function(response) {

    var chunks = new Array();

    // Explicitly handle redirects
    if(response.statusCode === 302) {
      return this.HTTPGETWrapper(response.headers.location, callback);
    }

    // Stop any failed request
    if(response.statusCode !== 200) {
      return callback(null);
    }

    response.on("data", function(data) {
      chunks.push(data);
    });

    response.on("end", function() {
      callback(Buffer.concat(chunks).toString());
    });

  }.bind(this));

  // Retry in 60 seconds
  request.on("error", function(error) {
    setTimeout(this.updateDOIs.bind(this), 60000);
  }.bind(this));

  // End the request
  request.end();

}

// Expose the class
module.exports.server = DOIWebservice;
module.exports.__VERSION__ = __VERSION__;

if(require.main === module) {

  const CONFIG = require("./config");

  // Start up the WFCatalog
  new module.exports.server(CONFIG, function(name, host, port) {
    console.log(name + " microservice has been started on " + host + ":" + port);
  });

}
