TrafGrapher
===========

TrafGrapher is an javascript script to collect and display data.
It can read MRTG log files, or can collect it's own data.
Also useable to display SAN storage performance or Nagios performance data.

No need for PHP or other daemon on your server. Everything is done in your
favorite browser using javascript.

### Features

* pure html/javascript/css - no need for server scripting
* display multiple graphs at once (also multiple routers)
* can handle integer or floating point, positive or negative values
* combine and compare selected interfaces
* custom time ranges
* display total of transfered bytes for selected time range
* display exact transfer speed for selected time
* multiple graphing modes:
  * JSON mode, collect performance data using tgc.py from various sources:
     * SNMP
     * /proc/net/dev
     * ipset rules
     * iptables rules
  * MRTG mode, reuse MRTG log files
  * graph SAN storage performance
     * DELL Compellent storage
     * EMC Clarion CX4-120
     * IBM Storwize (tested on V3700)
  * Nagios performance data
* any browser support (mobile devices too)
* less intensive disk writes for .log files

### Requirements:

* flotcharts from http://flotcharts.org
* installed and configured MRTG (for MRTG graphs only)
* web server with allowed directory indexing (for storage graph only)

How to install?
---------------

### Download from git.salstar.sk:

```
git clone http://git.salstar.sk/trafgrapher.git
cd trafgrapher
```

### Download flotcharts and unpack it into "flot" directory:
```
git clone https://github.com/flot/flot
make
```
### or:
```
curl http://www.flotcharts.org/downloads/flot-0.8.3.tar.gz | tar xvzf -
```

Usage
-----

Just point your web browser to trafgrapher script and give him some options,
for example:

`http://localhost/trafgrapher/network.html?m=/mrtg/router/`  
`http://localhost/trafgrapher/network.html?j=/tg/router/index.json`

### How to collect data from IBM Storwize

Create "mrtg" or "iostats" directory and copy statistics data from storage.

For IBM storwize you have to use these commands:
```
IOSTATS=/var/log/storwize
NODE=1
HOST=192.168.1.$((NODE+1))
ssh -q $HOST "cpdumps -prefix /dumps/iostats $NODE"
scp $HOST:"/dumps/iostats/N*_stats_*" $IOSTATS/
```
Open URL to your web server and enjoy graphs:
```
http://localhost/trafgrapher/?m=/path/to/mrtg/index.html
http://localhost/trafgrapher/?s=/path/to/iostats/
```

Keyboard shortcuts
------------------

| Key  | Command
| ---- | -----------------------------------------
| R    | Reload
| A    | Select all
| X    | Invert selection
| N    | Select none
| Z    | Zoom out
| 0    | Interval 3 years
| 2    | Interval 2 years
| 9    | Interval 1 year
| 5    | Interval 1 month
| 7    | Interval 1 week
| 3    | Interval 3 days
| 1    | Interval 1 day
| 8    | Interval 8 hours
| 4    | Interval 4 hours
