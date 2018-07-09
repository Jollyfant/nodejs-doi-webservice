# nodejs-doi-webservice
Application that harvests DOI information per EIDA network code and exposes the information through an HTTP API. Information is harvested from:

    http://www.fdsn.org/networks/doi/

## Installation

    npm install

## Configuration
Modify config.json to suit your needs.

## Running

    node index.js

## Docker

    docker build -t doi-webservice:1.0 .
    docker run -p 8087:8087 [--rm] [-d] [-e "SERVICE_PORT=8087"] [-e "SERVICE_HOST=0.0.0.0"] doi-webserivce:1.0

Four envrionment variables can passed to Docker run to modify settings at runtime. Otherwise information is read from the built configuration file.

  * SERVICE\_HOST
  * SERVICE\_PORT

## API
The supported parameters are valid SEED stream identifiers. Multiple stream identifiers may be delimited by a comma.

  * network

## Example

    $ curl "127.0.0.1:8087?network=GE"

    [{
        "network":"GE",
        "doi":"10.14470/TR560404"
    }]
