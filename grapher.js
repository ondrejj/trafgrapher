/*
  TrafGrapher
  (c) 2015 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>
  Licensed under the MIT license.
*/

var trafgrapher_version = 0.9,
    one_hour = 3600000;

// Join two arrays into one. For same keys sum values.
function joinarrays(arr) {
  var d = {};
  if (arr[0]) {
    for (var i=0; i<arr[0].length; i++) {
      var key = arr[0][i][0];
      d[key] = arr[0][i][1];
    }
  }
  for (var arr_id=1; arr_id<arr.length; arr_id++) {
    if (arr[arr_id]) {
      for (var i=0; i<arr[arr_id].length; i++) {
        var key = arr[arr_id][i][0];
        if (d[key]===undefined) d[key] = 0;
        d[key] += arr[arr_id][i][1];
      }
    }
  }
  var a = [];
  for (var key in d) {
    a.push([key, d[key]]);
  }
  a.sort(function (a,b) {
    return a[0]-b[0]
  });
  return a;
}

// Create array with deltas of two arrays.
function arraydelta(nodes, rw) {
  if (!nodes) return [];
  if (nodes.length==0) return [];
  var deltas = [];
  nodes.sort(function (a,b) {
    return a[0]-b[0]
  });
  var prev = nodes[0];
  for(var i=1; i<nodes.length; i++) {
    var item = nodes[i];
    var value = item[1]-prev[1];
    // divide by 1000 because time is in miliseconds
    var time_interval = (item[0]-prev[0])/1000;
    if (value<0) value = 0;
    deltas.push([item[0], value/time_interval]);
    prev = item;
  }
  return deltas;
}

// inverse values
function arrayinverse(arr) {
  var ret = [];
  for(var i=0; i<arr.length; i++)
    ret.push([arr[i][0], -arr[i][1]]);
  return ret;
}

// Parse date and time in format "YYMMHH HHMMSS" into Date object.
function parsedatetime(d, t) {
  return Date.parse(
    "20" + d[0]+d[1]+"-" + d[2]+d[3]+"-" + d[4]+d[5]+"T" +
    t[0]+t[1]+":" + t[2]+t[3]+":" + t[4]+t[5]
  );
}

// Color generator from flot
function gen_colors(neededColors) {
  var colorPool = ["#4da74d", "#cb4b4b", "#9440ed", "#edc240", "#afd8f8"],
      colorPoolSize = colorPool.length,
      colors = [], variation = 0;
  for (var i = 0; i < neededColors; i++) {
    c = $.color.parse(colorPool[i % colorPoolSize] || "#666");

    // Each time we exhaust the colors in the pool we adjust
    // a scaling factor used to produce more variations on
    // those colors. The factor alternates negative/positive
    // to produce lighter/darker colors.

    // Reset the variation after every few cycles, or else
    // it will end up producing only white or black colors.

    if (i % colorPoolSize == 0 && i) {
      if (variation >= 0) {
        if (variation < 0.5) {
          variation = -variation - 0.2;
        } else variation = 0;
      } else variation = -variation;
    }
    colors[i] = c.scale('rgb', 1 + variation);
  }
  return colors;
}

// Format datetime
function format_int(x) {
  if (x<10) return "0"+x;
  return x;
}
function format_datetime(ts) {
  var d = new Date(ts);
  return d.getFullYear() + "-"
       + format_int(d.getMonth()) + "-" + format_int(d.getDay()) + " "
       + format_int(d.getHours()) + ":" + format_int(d.getMinutes()) + ":"
       + format_int(d.getSeconds());
}

/*
  Graph object
  =============
*/

var Graph = function(ID) {
  this.ID = ID;
  this.div = $("div#"+ID);
  this.deltas = {}; this.counters = {};
  this.json_files = []; this.mrtg_files = []; this.storage_files = [];
  this.plot = null;
  this.range_from = null; this.range_to = null;
  this.unit_by_type = {
    'b': "B/s",
    'o': "io/s",
    'l': "ms",
    't': "tr/s",
  };
  this.unit = this.unit_by_type['b'];
  this.excluded_interfaces = [
    // CISCO
    /^unrouted[\ \-]VLAN/,
    /^Control.Plane.Interface/,
    // DELL
    /^[\ \-]Link[\ \-]Aggregate[\ \-]/,
    /^[\ \-]CPU[\ \-]Interface[\ \-]for[\ \-]Unit:[\ \-]/,
    /^Backbone$/,
  ];
  this.preselect_graphs = [];
  this.loader = this.div.find("[id^=loader]");
  this.placeholder = this.div.find("[id^=placeholder]");
  this.filter = this.div.find("[id^=filter]");
  this.interval = this.div.find("[id^=interval]");
  this.graph_source = this.div.find("[id^=graph_source]");
  this.graph_type = this.div.find("[id^=graph_type]");
  this.unit_type = this.div.find("[id^=unit_type]");
  this.add_callbacks();
}

Graph.prototype.find = function(id, selectors) {
  var sel = "[id^="+id+"]";
  if (selectors===undefined) {
    return this.div.find(sel);
  } else {
    return this.div.find(sel+" "+selectors);
  }
}

// Show error message
Graph.prototype.error = function(msg) {
  this.find("error").text(msg);
  this.find("error").show();
  this.find("download").show();
}

// Set/unset all input choices for filter.
Graph.prototype.toggleall = function() {
  var inputs_all = this.filter.find("input"),
      inputs_checked = this.filter.find("input:checked");
  if ($(inputs_all).length == $(inputs_checked).length) {
    $(inputs_all).attr("checked", false);
  } else {
    $(inputs_all).attr("checked", true);
  }
  this.plot_graph();
}

// Convert unit to kilo, mega, giga or tera.
Graph.prototype.unit_si = function(val, axis, unit) {
  var k = 1024, precision = 2, aval = Math.abs(val);
  if (axis && axis.tickDecimals) precision = axis.tickDecimals;
  if (typeof(axis)=="number") precision = axis;
  if (unit===undefined && axis) unit = axis.options.si_unit;
  if (unit=="ms") {
    if (aval>=k) return (aval/k).toFixed(precision)+" s";
  } else {
    if (aval>=(k*k*k*k*k))
      return (aval/k/k/k/k/k).toFixed(precision)+" P"+unit;
    if (aval>=(k*k*k*k))
      return (aval/k/k/k/k).toFixed(precision)+" T"+unit;
    if (aval>=(k*k*k))
      return (aval/k/k/k).toFixed(precision)+" G"+unit;
    if (aval>=(k*k))
      return (aval/k/k).toFixed(precision)+" M"+unit;
    if (aval>=k)
      return (aval/k).toFixed(precision)+" k"+unit;
  }
  if (unit[0]=="i")
    return aval.toFixed(precision)+" "+unit.substr(1);
  return aval.toFixed(precision)+" "+unit;
}

// Array bytes
Graph.prototype.arraybytes = function(arr) {
  var bytes = 0, last = null;
  if (arr.length==0) return 0;
  for (var idx=arr.length-1; idx>=0; idx--) {
    var t = arr[idx][0];
    if (this.range_from<=t && t<this.range_to && arr[idx][1]!=undefined) {
      if (last==null) last = t;
      bytes += Math.abs(arr[idx][1])*(t-last)/1000;
      last = t;
    }
  }
  return bytes;
}

// Get data for current time interval
Graph.prototype.filter_interval = function(data, unit, use_max) {
  var ret = [];
  var multiply = 1;
  if (unit=="b") multiply = 8; // bits
  for (var i=0; i<data.length; i++)
    if (data[i][0]>=this.range_from && data[i][0]<this.range_to)
      ret.push([data[i][0], data[i][1]*multiply]);
  if (ret.length>400) {
    // group data
    var min_t = ret[0][0], max_t = ret[ret.length-1][0];
    var vsum = [], vcnt = [], vmax = [], gi = Math.abs(max_t-min_t)/400;
    for (var i=0; i<ret.length; i++) {
      var ti = Math.floor(ret[i][0]/gi);
      if (ti in vcnt) {
        vcnt[ti] += 1;
        vsum[ti] += ret[i][1];
        vmax[ti] = Math.max(vmax[ti], ret[i][1]);
      } else {
        vcnt[ti] = 1;
        vsum[ti] = ret[i][1];
        vmax[ti] = ret[i][1];
      }
    }
    ret = [];
    for (var key in vcnt)
      if (use_max) {
        ret.push([key*gi, vmax[key]]);
      } else {
        ret.push([key*gi, vsum[key]/vcnt[key]]);
      }
  }
  return ret;
}

// Reset range
Graph.prototype.reset_range = function() {
  // set current interval
  var current_datetime = new Date(),
      range_end = this.div.find("[name^=range_end]").attr("value");
  this.time_interval = parseInt(this.interval.attr("value"));
  if (range_end) current_datetime = range_end * 1000;
  this.range_from = Number(current_datetime - this.time_interval*one_hour);
  this.range_to = Number(current_datetime); // convert to number
}

// Add callbacks for graph
Graph.prototype.add_callbacks = function() {
  var self = this;
  // buttons and selectors
  this.interval.change(function() {self.refresh_range()});
  this.graph_source.change(function() {self.change_source()});
  this.find("menu").change(function() {self.menu_selected()}).val("");
  this.find("toggle_info").click(function() {
    self.find("info_table").animate({height: "toggle"}, 300);
  });
  this.find("toggle_filter").click(function() {
    self.filter.toggle();
  });
  // selection
  this.placeholder.bind("plotselected", function (event, ranges) {
    // zoom
    self.range_from = ranges.xaxis.from;
    self.range_to = ranges.xaxis.to;
    self.plot.clearSelection();
    self.plot_graph();
  });
  // hover and click
  this.placeholder.bind("plothover", function(event, pos, item) {
    if (item) {
      var label = item.series.label.name;
      self.filter.find("li").css("border-color", "transparent");
      self.filter.find("li#li"+self.ID+label).css("border-color", "black");
      self.find("throughput").attr("value",
        self.unit_si(item.datapoint[1], 2, self.unit));
      // compute bytes
      var graph_type = item.series.label.gt;
      self.find("bytes").attr("value",
        self.unit_si(self.arraybytes(self.deltas[label][graph_type]),
          null, 'iB'));
      var description = self.deltas[label]['name'],
          switchname = self.deltas[label]['ip'];
      //if (self.deltas[label]['port_id'])
      //  switchname = switchname + " [" + self.deltas[label]['port_id'] + "]";
      self.find("ifname").attr("value", description);
      self.find("switchname").attr("value", switchname);
      // display information from json file
      if (self.json_files.length>0 && self.deltas[label]['info']) {
        var table = ['<table>'], info = self.deltas[label]['info'],
            ftime = format_datetime(item.datapoint[0]);
        table.push("<tr><td>Time</td><td>"+ftime+"</td></tr>");
        for (var key in info)
          if (key!="log")
            table.push(
              "<tr><td>"+key+"</td><td>"
              +info[key]+"</td></tr>"
            );
        table.push("</table>");
        self.find("info_table").html($(table.join('\n')));
      }
      // load table information from MRTG html file
      if (self.mrtg_files.length>0 && self.deltas[label]['html']) {
        $.ajax({
          url: self.deltas[label]['html'],
          dataType: "html",
        }).done(function(data) {
          // don't load images from .html
          var noimgdata = data.replace(/\ src=/gi, " nosrc=");
          var table = $(noimgdata).find("table");
          self.find("info_table").html(table[0]);
        });
      }
    }
  });
  this.placeholder.bind("plotclick", function(event, pos, item) {
    if (item) {
      var label = item.series.label.name;
      self.div.find("input#cb"+self.ID+label).attr("checked",
        !self.div.find("input#cb"+self.ID+label).prop("checked")
      );
      self.plot_graph();
    }
  });
}
Graph.prototype.urllink = function() {
  var self = this, ports = [],
      inputs_all = this.filter.find("input"),
      inputs_checked = this.filter.find("input:checked");
  if (this.json_files.length>0) {
    var url = "?j="+this.json_files[0].split(";")[0];
  } else if (this.mrtg_files.length>0) {
    var url = "?m="+this.mrtg_files[0].split(";")[0];
  } else if (this.storage_files.length>0) {
    var url = "?s="+this.storage_files[0].split(";")[0];
  } else {
    return;
  }
  if (inputs_checked.length<inputs_all.length) {
    inputs_checked.each(function() {
      if (self.storage_files.length>0) {
        ports.push(this.name);
      } else {
        ports.push(self.deltas[this.name]["port_id"]);
      }
    });
    if (ports.length>0)
      url += ";" + ports.join(";");
  }
  url += "&i=" + this.interval.val() + "h";
  url += "&u=" + this.unit_type.val();
  window.location = window.location.href.split("?")[0] + url;
}
Graph.prototype.menu_selected = function() {
  var self = this,
      sel = this.find("menu", "option:selected").val(),
      inputs_all = this.filter.find("input");
  if (sel=="") {
    return;
  } else if (sel=="all") {
    $(inputs_all).attr("checked", true);
    this.plot_graph();
  } else if (sel=="none") {
    $(inputs_all).attr("checked", false);
    this.plot_graph();
  } else if (sel=="inv") {
    $(inputs_all).each(function() {
      var sel = $(this);
      sel.attr("checked", !sel.attr("checked"));
    });
    this.plot_graph();
  } else if (sel=="virtual") {
    $(inputs_all).each(function() {
      var sel = $(this);
      if (self.deltas[this.name]['info']
          && self.deltas[this.name]['info']['ifType']=='propVirtual')
        sel.attr("checked", !sel.attr("checked"));
    });
    this.plot_graph();
  } else if (sel=="zoomout") {
    this.zoom_out();
  } else if (sel=="reload") {
    this.refresh_graph();
  } else if (sel=="urllink") {
    this.urllink();
  }
  this.find("menu").val("");
}

// Update checkboxes according to number of graphs.
Graph.prototype.update_checkboxes = function() {
  var self = this;
  // Skip updating filter checkboxes if at least one of them is checked.
  // All checkboxes are unchecked when switching graph source to allow
  // update.
  if (this.filter.find("input:checked").length>0) return;
  this.filter.empty();
  var keys = [];
  for (var key in this.deltas) keys.push(key);
  keys.sort();
  for (var keyid in keys) {
    var key = keys[keyid], idkey = this.ID+key,
        checked = "checked='checked'";
    if (this.preselect_graphs.length>0)
      if ($.inArray(key, this.preselect_graphs)<0)
        checked = "";
    this.filter.append("<li id='li" + idkey +
      "'><table><tr>" +
      "<td><div class='box'>&nbsp;</div></td>" +
      "<td><input type='checkbox' name='" + key +
        "' " + checked + " id='cb" + idkey + "'></input></td><td>" +
      this.deltas[key]['name'] +
      "</td></tr></table></li>");
  }
  self.preselect_graphs = []; // clear after apply
  // Add actions.
  this.filter.find("input").click(function() {self.plot_graph()});
  this.graph_type.change(function() {self.plot_graph()});
  this.unit_type.change(function() {self.plot_graph()});
}

// Plot current graph.
Graph.prototype.plot_graph = function() {
  var flots = [];
  var graph_type = this.graph_type.find("option:selected").attr("value");
  var unit = this.unit_type.find("option:selected").attr("value");
  if (unit===undefined) {
    if (graph_type[1] in this.unit_by_type) {
      this.unit = this.unit_by_type[graph_type[1]];
    } else {
      this.unit = "";
    }
  } else {
    this.unit = 'i'+unit+"/s";
  }
  var inputs_all = this.filter.find("input"),
      inputs_checked = this.filter.find("input:checked");
  if (inputs_all.length == inputs_checked.length) {
    this.find("all_none").attr("value", "NONE");
  } else {
    this.find("all_none").attr("value", "ALL");
  }
  var checked_choices = this.filter.find("input:checked");
  var colors = gen_colors(checked_choices.length);
  for (var n=0; n<checked_choices.length; n++) {
    var choice = checked_choices[n];
    var name = $(choice).attr("name");
    if (this.mrtg_files.length>0 || this.json_files.length>0) {
      // mrtg graph
      for (var gt=0; gt<graph_type.length; gt++) {
        flots.push({
          //label: graph_type[gt]+"_"+name,
          label: {name: name, gt: graph_type[gt]},
          color: String(colors[n]),
          data: this.filter_interval(
                  this.deltas[name][graph_type[gt]], unit,
                  graph_type[gt]==graph_type[gt].toUpperCase()
                )
        })
      }
    } else if (graph_type[0]=="x") {
      // storage read and write graph
      flots.push({
        label: {name: name, gt: 'r'+graph_type[1]},
        color: colors[n],
        data: this.filter_interval(this.deltas[name]['r'+graph_type[1]])
      })
      flots.push({
        label: {name: name, gt: 'w'+graph_type[1]},
        color: colors[n],
        data: this.filter_interval(arrayinverse(
                this.deltas[name]['w'+graph_type[1]]))
      })
    } else {
      // storage one way graph (read or write only)
      flots.push({
        label: {name: name, gt: graph_type[0]},
        color: colors[n],
        data: this.filter_interval(this.deltas[name][graph_type])
      })
    }
  }
  this.plot = $.plot(this.placeholder, flots, {
    xaxis: { mode: "time", timezone: "browser" },
    yaxis: {
      tickFormatter: this.unit_si,
      si_unit: this.unit,
      tickDecimals: 1
    },
    legend: { show: false },
    grid: { hoverable: true, clickable: true },
    selection: { mode: "x" }
  });
  // set checkbox colors
  var series = this.plot.getData();
  this.div.find("li div.box").css("background-color", "transparent"
    ).css("border-color", "transparent");
  for (var i=0; i<series.length; i++) {
    this.div.find("li#li"+this.ID+series[i].label.name+" div").css(
      "background-color", series[i].color.toString()).css(
      "border-color", "black").css(
      "color", "white");
  }
  // clear last graph values
  this.find("throughput").attr("value", "");
  this.find("bytes").attr("value", "");
  this.find("ifname").attr("value", "");
  this.find("switchname").attr("value", "");
  this.find("info_table").empty();
}

/*
  Data loaders
  =============
*/

Loader = function(graph, files) {
  this.graph = graph;
  this.files = files;
  this.tagsrc = graph.graph_source.find("option:selected").attr("value");
  this.progress = graph.loader.find("[id^=progress]");
  this.progress.text("");
  this.files_to_load = 0;
  this.loaded_bytes = 0;
  graph.deltas = {};
  graph.counters = {};
  // show loader
  graph.placeholder.empty();
  graph.placeholder.append(graph.loader);
  // set current interval
  graph.reset_range();
}

// File loaded, update counter, show graph if all files processed.
Loader.prototype.file_loaded = function(remaining_files) {
  if (remaining_files===undefined)
    this.files_to_load -= 1;
  else
    this.files_to_load = remaining_files;
  if (this.files_to_load==0) {
    var counters = this.graph.counters, deltas = this.graph.deltas;
    // if counters is empty, this is skipped
    for (var name in counters) {
      if (!deltas[name]) {
        deltas[name] = {name: name};
        for (var key in this.data_items)
          deltas[name][this.data_items[key]] = [];
      }
      for (var rw in counters[name]) {
        var arrs = [];
        for (var nodeid in counters[name][rw])
          arrs.push(arraydelta(counters[name][rw][nodeid], rw));
        deltas[name][rw] = joinarrays(arrs);
      }
    }
    this.graph.update_checkboxes();
    this.graph.plot_graph();
  } else {
    this.progress.html(this.files_to_load+
      " files to load (<a href=\"\">skip</a>)"
    );
    var loader = this;
    this.progress.find("a").click(function() {
      loader.file_loaded(0);
      return false;
    });
  }
}

Loader.prototype.load_all = function() {
  for (var idx=0; idx<this.files.length; idx++)
    this.load_index(this.files[idx]);
}

// Old browser support
if (!Object.create) {
  Object.create = function(proto) {
    function f() {}
    f.prototype = proto;
    return new f();
  }
}

/*
  JSON functions
  ============
*/

JSONLoader = function(graph, files) {
  Loader.call(this, graph, files);
}

JSONLoader.prototype = Object.create(Loader.prototype);

// Load log file.
JSONLoader.prototype.load_log = function(filename, args) {
  var self = this, deltas = this.graph.deltas;
  $.ajax({
    url: filename,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var ethid = args.ethid;
    var lines = data.split('\n');
    name = $('<div/>').text(args.name).html(); // escape html in name
    deltas[ethid] = {'o': [], 'i': [], 'j': [], 'O': [], 'I': [], 'J': []};
    for (var key in args) deltas[ethid][key] = args[key]; // copy args
    lines.shift(); // remove couter line
    lines = lines.map(function(row) {
      return row.split(" ").map(function(col) { return parseInt(col) })
    });
    lines.sort(function(a, b) { return a[0]-b[0]});
    for (var line=0; line<lines.length; line++) {
      var cols = lines[line];
      var t = cols[0]*1000,
          ib = cols[1], ob = cols[2],
          im = cols[3], om = cols[4];
      deltas[ethid]['i'].push([t, ib]);
      deltas[ethid]['j'].push([t, -ib]);
      deltas[ethid]['o'].push([t, ob]);
      deltas[ethid]['I'].push([t, im]);
      deltas[ethid]['J'].push([t, -im]);
      deltas[ethid]['O'].push([t, om]);
    }
    self.loaded_bytes += data.length | 0;
    self.file_loaded();
  }).fail(function(jqXHR, textStatus, error) {
    self.graph.error("Failed to load log file: " + filename + ": " + error);
  });
}

// Load json index and start loading of files.
JSONLoader.prototype.load_index = function(url) {
  var self = this, graph = this.graph;
  // load index file
  var preselect_graphs = url.split(";");
  url = preselect_graphs.shift();
  var urldir = url.replace(/[^\/]*$/, "");
  graph.preselect_graphs = [];
  $.ajax({
    url: url,
    dataType: "json",
    cache: false
  }).done(function(data) {
    var files = [];
    for (var port_id in data.ifs) {
      for (var i in graph.excluded_interfaces)
        if (data.ifs[port_id].ifDescr.search(graph.excluded_interfaces[i])>=0) {
          port_id = null;
          break;
        }
      if (port_id==null) continue;
      var ethid = data.ip.replace(/[^a-z0-9]/gi, '_')
                + port_id.replace(".", "_");
      files.push({
        'filename': urldir + data.ifs[port_id].log,
        'port_id': port_id,
        'ethid': ethid,
        'name': data.ifs[port_id].ifAlias || data.ifs[port_id].ifDescr,
        'ip': data.ip,
        'info': data.ifs[port_id]
      });
      if (preselect_graphs.length>0)
        if ($.inArray(port_id, preselect_graphs)>=0)
          graph.preselect_graphs.push(ethid);
    }
    self.loaded_bytes += data.length | 0;
    self.files_to_load += files.length;
    if (files.length<=0)
      self.progress.text("No data to load");
    for (var fni=0; fni<files.length; fni++)
      self.load_log(files[fni]["filename"], files[fni]);
  }).fail(function(jqXHR, textStatus, error) {
    graph.error("Failed to load index file: " + url + ": " + error);
  });
}

/*
  MRTG functions
  ===============
*/

MRTGLoader = function(graph, files) {
  Loader.call(this, graph, files);
}

MRTGLoader.prototype = Object.create(JSONLoader.prototype);

// Load file index and start loading of files.
MRTGLoader.prototype.load_index = function(url) {
  var self = this, graph = this.graph;
  // loading separate log file?
  if (url.search(/\.log$/)>0) {
    self.files_to_load += 1;
    self.load_log(url, {
      'filename': url,
      'port_id': '1',
      'name': url,
      'ip': url
    });
    return;
  }
  // load index file
  var preselect_graphs = url.split(";");
  url = preselect_graphs.shift().replace(/[^\/]*$/, ""); // rm filename
  graph.preselect_graphs = [];
  $.ajax({
    url: url,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var files = [];
    // don't load images from index.html
    var noimgdata = data.replace(/\ src=/gi, " nosrc=");
    $(noimgdata).find("td").each(function(tagi, tag) {
      var tag = $(tag), diva = tag.find("div a");
      if (diva[0]) {
        var href = diva.attr("href"),
            fname = href.substr(0, href.lastIndexOf(".")),
            name = tag.find("div b").text(),
            name_idx = name.indexOf(": "),
            switch_ip = url;
        if (name_idx>=0) {
          switch_ip = name.substr(0, name_idx);
          name = name.substr(name_idx+2);
        }
        for (var i in graph.excluded_interfaces)
          if (name.search(graph.excluded_interfaces[i])>=0)
            return;
        var file_prefix = url+fname,
            basename = file_prefix.substr(file_prefix.lastIndexOf('/')+1),
            port_id = basename.substr(basename.indexOf('_')+1);
        var ethid = switch_ip.replace(/[^a-z0-9]/gi, '_')
                  + port_id.replace(".", "_");
        files.push({
          'filename': file_prefix+".log",
          'port_id': port_id,
          'ethid': ethid,
          'name': name,
          'ip': switch_ip,
          'html': file_prefix+".html"
        });
        if (preselect_graphs.length>0)
          if ($.inArray(port_id, preselect_graphs)>=0)
            graph.preselect_graphs.push(ethid);
      }
    });
    self.loaded_bytes += data.length | 0;
    self.files_to_load += files.length;
    if (files.length<=0)
      self.progress.text("No data to load");
    for (var fni=0; fni<files.length; fni++)
      self.load_log(files[fni]["filename"], files[fni]);
  }).fail(function(jqXHR, textStatus, error) {
    graph.error("Failed to load index file: " + url + ": " + error);
  });
}

/*
  Storage functions
  ==================
*/

StorageLoader = function(graph, files) {
  Loader.call(this, graph, files);
}

StorageLoader.prototype = Object.create(Loader.prototype);

// Load storwize stats for one file.
StorageLoader.prototype.load_storwize = function(filename) {
  var self = this, counters = this.graph.counters;
  $.ajax({
    url: filename,
    dataType: "xml"
  }).done(function(data) {
    var nodeid = parseInt(filename.split("_")[2].split("-")[1])-1;
    var colls = data.getElementsByTagName("diskStatsColl");
    if (self.tagsrc=="disk") self.tagsrc = "mdsk";
    for (var coll_id=0; coll_id<colls.length; coll_id++) {
      var coll = colls[coll_id];
      var timestamp = Date.parse(
        coll.attributes["timestamp"].value.replace(" ", "T")
      );
      var sizeunit = parseInt(
        coll.attributes["sizeUnits"].value.replace("B", "")
      );
      var dsks = coll.getElementsByTagName(self.tagsrc);
      for (var dsk_id=0; dsk_id<dsks.length; dsk_id++) {
        var dsk = dsks[dsk_id], value,
            name = dsk.attributes['id'].value;
        if (!name) name = dsk.attributes['idx'].value;
        if (!counters[name]) {
          counters[name] = {};
          for (var key in self.data_items)
            counters[name][self.data_items[key]] = [[], []];
        }
        for (var rw in counters[name]) {
          if (rw=="rt") srw = "ctr"
          else if (rw=="wt") srw = "ctw"
          else srw = rw;
          if (dsk.attributes[srw]) {
            value = parseInt(dsk.attributes[srw].value);
            if (rw=="rb" || rw=="wb") value *= sizeunit;
            counters[name][rw][nodeid].push([timestamp, value]);
          }
        }
      }
    }
    self.loaded_bytes += data.length | 0;
    self.file_loaded();
  });
}

// Load unisphere stats for one file.
StorageLoader.prototype.load_unisphere = function(filename) {
  var self = this, counters = this.graph.counters;
  $.ajax({
    url: filename
  }).done(function(data) {
    var rows = data.split("\n");
    var name = "", lun="", rg="", timestamp, sizeunit=512;
    for (var row_id=0; row_id<rows.length; row_id++) {
      var row = rows[row_id];
      var args = row.split(" ");
      var rargs = args.slice();
      rargs.reverse();
      if (row.indexOf("Name   ")==0) {
        if (rargs[1]!="LUN") {
          name = rargs[0];
          if (self.tagsrc=="vdsk") {
            if (!counters[name]) {
              counters[name] = {};
              for (var key in self.data_items)
                counters[name][self.data_items[key]] = [];
            }
          }
        } else {
          name = "";
        }
      } else if (row.indexOf("RAIDGroup ID:")==0) {
        rg = rargs[0];
        if (self.tagsrc=="mdsk") {
          if (!counters[rg]) {
            counters[rg] = {};
            for (var key in self.data_items)
              counters[rg][self.data_items[key]] = [];
          }
        }
      } else if (row.indexOf("Statistics logging current time:")==0) {
        var t = rargs[0], d = rargs[1];
        timestamp = Date.parse(
          "20"+d[6]+d[7]+"-"+d[0]+d[1]+"-"+d[3]+d[4]+"T"+t
        )
      }
      if (name!="") {
        if (self.tagsrc=="vdsk") {
          if (row.indexOf("Blocks Read")==0) {
            var idx = args[2];
            if (!counters[name].rb[idx]) counters[name].rb[idx] = [];
            counters[name].rb[idx].push(
              [timestamp, parseInt(args[14])*sizeunit]);
          } else if (row.indexOf("Blocks Written")==0) {
            var idx = args[2];
            if (!counters[name].wb[idx]) counters[name].wb[idx] = [];
            counters[name].wb[idx].push(
              [timestamp, parseInt(args[11])*sizeunit]);
          } else if (row.indexOf("Read Histogram[")==0) {
            var hid = args[1][10];
            if (!counters[name].ro[hid]) counters[name].ro[hid] = [];
            counters[name].ro[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Write Histogram[")==0) {
            var hid = args[1][10];
            if (!counters[name].wo[hid]) counters[name].wo[hid] = [];
            counters[name].wo[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Average Read Time:")==0) {
            if (!counters[name].rl.one) counters[name].rl.one = [];
            counters[name].rl.one.push([timestamp, parseInt(rargs[0])]);
          } else if (row.indexOf("Average Write Time:")==0) {
            if (!counters[name].wl.one) counters[name].wl.one = [];
            counters[name].wl.one.push([timestamp, parseInt(rargs[0])]);
          }
        } else if (self.tagsrc=="mdsk") {
          if (row.indexOf("Blocks Read")==0) {
            var idx = name+args[2];
            if (!counters[rg].rb[idx]) counters[rg].rb[idx] = [];
            counters[rg].rb[idx].push(
              [timestamp, parseInt(args[14])*sizeunit]);
          } else if (row.indexOf("Blocks Written")==0) {
            var idx = name+args[2];
            if (!counters[rg].wb[idx]) counters[rg].wb[idx] = [];
            counters[rg].wb[idx].push(
              [timestamp, parseInt(args[11])*sizeunit]);
          } else if (row.indexOf("Read Histogram[")==0) {
            var hid = name+args[1][10];
            if (!counters[rg].ro[hid]) counters[rg].ro[hid] = [];
            counters[rg].ro[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Write Histogram[")==0) {
            var hid = name+args[1][10];
            if (!counters[rg].wo[hid]) counters[rg].wo[hid] = [];
            counters[rg].wo[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Average Read Time:")==0) {
            if (!counters[rg].rl[name]) counters[rg].rl[name] = [];
            counters[rg].rl[name].push([timestamp, parseInt(rargs[0])]);
          } else if (row.indexOf("Average Write Time:")==0) {
            if (!counters[rg].wl[name]) counters[rg].wl[name] = [];
            counters[rg].wl[name].push([timestamp, parseInt(rargs[0])]);
          }
        }
      }
    }
    self.loaded_bytes += data.length | 0;
    self.file_loaded();
  });
}

// Load file index and start loading of files.
StorageLoader.prototype.load_index = function(url) {
  var self = this;
  this.data_items = ["rb", "wb", "ro", "wo", "rl", "wl", "rt", "wt"];
  var preselect_graphs = url.split(";");
  url = preselect_graphs.shift()
  self.graph.preselect_graphs = preselect_graphs;
  $.ajax({
    url: url,
    cache: false
  }).done(function(data) {
    var files = [];
    var tags = $(data).find("a");
    var current_datetime = new Date(), interval = self.graph.time_interval;
    for (var tagi=0; tagi<tags.length; tagi++) {
      var href = tags[tagi].getAttribute("href");
      if (href[href.length-1]=="/") continue;
      // Storwize
      if (href.indexOf("N"+self.tagsrc[0]+"_stats_")==0) {
        var hrefa = href.split("_");
        var d = hrefa[3], t = hrefa[4];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push(url+href);
      }
      // Unisphere
      if (href.indexOf("Uni_")==0) {
        var hrefa = href.split("_");
        var d = hrefa[hrefa.length-2], t = hrefa[hrefa.length-1];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push(url+href);
      }
    }
    self.loaded_bytes += data.length | 0;
    self.files_to_load += files.length;
    if (self.files_to_load<=0)
      self.progress.text("No data to load");
    for (var fni=0; fni<self.files_to_load; fni++) {
      if (files[fni].indexOf(url+"N")==0) {
        self.load_storwize(files[fni]);
      } else if (files[fni].indexOf(url+"U")==0) {
        self.load_unisphere(files[fni]);
      }
    }
  }).fail(function(jqXHR, textStatus, error) {
    self.graph.error(
      "Failed to load index file: " + url + ": " + error
    );
  });
}

/*
  Common functions
  =================
*/

Graph.prototype.refresh_range = function() {
  if (this.storage_files.length>0) {
    this.refresh_graph();
  } else {
    this.reset_range();
    this.plot_graph();
  }
}

Graph.prototype.refresh_graph = function() {
  this.range_from = null;
  this.range_to = null;
  if (this.json_files.length>0) {
    var loader = new JSONLoader(this, this.json_files);
  } else if (this.mrtg_files.length>0) {
    var loader = new MRTGLoader(this, this.mrtg_files);
  } else if (this.storage_files.length>0) {
    var loader = new StorageLoader(this, this.storage_files);
  } else {
    this.error("No files to load.");
  }
  if (loader) loader.load_all();
}

Graph.prototype.change_source = function() {
  // Remove checkboxes, because new source has different checkboxes.
  this.filter.empty();
  this.refresh_graph();
}

Graph.prototype.zoom_out = function() {
  this.reset_range();
  this.plot_graph();
}

Graph.prototype.select_devices = function() {
  var self = this;
  // skip if files defined for query string
  if (self.json_files.length>0 ||
      self.mrtg_files.length>0 ||
      self.storage_files.length>0)
    return;
  this.div.find("[name^=json_file]").each(function() {
    self.json_files.push($(this).attr("value"));
  });
  this.div.find("[name^=mrtg_file]").each(function() {
    self.mrtg_files.push($(this).attr("value"));
  });
  this.div.find("[name^=storage_file]").each(function() {
    self.storage_files.push($(this).attr("value"));
  });
}

Graph.prototype.parse_query_string = function() {
  function split_arg(arg, arr) {
    var sarg = arg.split(",");
    var prefix = "";
    if (sarg[0].search("/")>=0)
      prefix = sarg[0].replace(/[^\/]*\/$/, '');
    arr.push(sarg[0]);
    for (var i=1; i<sarg.length; i++)
      arr.push(prefix+sarg[i]);
  }
  // parse query string
  var range_multiplier = {y: 8766, m: 744, w: 168, d: 24, h:1};
  var query = window.location.search.substring(1);
  if (query) {
    var args = query.split("&");
    for (var i in args) {
      var arg = args[i].split("=");
      if (arg[0]=="t") {
        this.graph_type.val(arg[1]);
      } else if (arg[0]=="u") {
        this.unit_type.val(arg[1]);
      } else if (arg[0]=="i") {
        var arg1 = arg[1], arg1l = arg1[arg1.length-1];
        if (arg1l in range_multiplier) {
          arg1 = Math.floor(parseFloat(arg1)*range_multiplier[arg1l]);
        } else {
          arg1 = Math.floor(parseFloat(arg1));
        }
        var itag = this.interval.find("option[value='"+arg1+"']");
        if (itag.length==0)
          this.interval.append(
            '<option value="'+arg1+'">'+arg1+' hours</option>'
          );
        this.interval.val(arg1);
      } else if (arg[0]=="s") {
        split_arg(arg[1], this.storage_files);
      } else if (arg[0]=="j") {
        split_arg(arg[1], this.json_files);
      } else {
        split_arg(arg[1], this.mrtg_files);
      }
    }
  }
  this.select_devices();
}

$(function() {
  $(".footer a").text(
    $(".footer a").text().replace("#.#", trafgrapher_version)
  );
  graphs = [];
  $("div[id^=graph]").each(function() {
    var graph = new Graph($(this).attr("id"));
    graph.parse_query_string();
    graph.refresh_graph();
    graphs.push(graph);
  });
});
