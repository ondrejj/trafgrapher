/*
  TrafGrapher
  (c) 2015-2016 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>
  Licensed under the MIT license.
*/

var trafgrapher_version = '1.2',
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
function arraydelta(nodes) {
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

// Convert to milisecond
function to_ms(value) {
  return parseInt(value)*1000;
}

// Parse date and time in format "YYMMHH HHMMSS" into Date object.
function parsedatetime(d, t) {
  if (d.length<8) d = "20" + d;
  return Date.parse(
    d[0]+d[1]+d[2]+d[3]+"-" + d[4]+d[5]+"-" + d[6]+d[7]+"T" +
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

// Escape selector ID
String.prototype.escapeSelector = function() {
  return this.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g,'\\$1');
}

/*
  Graph object
  =============
*/

var Graph = function(ID) {
  this.ID = ID;
  this.div = $("div#"+ID);
  this.deltas = {}; this.counters = {}; this.info = {};
  this.index_mode = "json";
  this.index_files = [];
  this.plot = null;
  this.range_from = null; this.range_to = null;
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
  if (unit && unit[0]=="i" && unit[1]!="o")
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
      range_end = this.div.find("[name^=range_end]").val();
  this.time_interval = parseInt(this.interval.val());
  if (range_end) current_datetime = range_end * 1000;
  this.range_from = Number(current_datetime - this.time_interval*one_hour);
  this.range_to = Number(current_datetime); // convert to number
}

// Get unit
Graph.prototype.get_unit = function(label) {
  var unit = this.info[label].unit;
  if (typeof(unit)=="string")
    return unit;
  else if (this.unit_type && this.unit_type.length>0)
    return unit[this.unit_type.find("option:selected").val()];
  else if (this.graph_type && this.graph_type.length>0)
    return unit[this.graph_type.find("option:selected").val()[1]];
  return unit;
}

// Add callbacks for plot
Graph.prototype.add_plot_callbacks = function() {
  var self = this;
  // hover and click
  this.placeholder.bind("plothover", function(event, pos, item) {
    if (item) {
      var label = item.series.label.name;
      if (!self.deltas[label]) return; // already not defined
      self.filter.find("li").css("border-color", "transparent");
      self.filter.find(
        "li#li"+self.ID+label.escapeSelector()
      ).css("border-color", "black");
      // compute bytes
      var graph_type = item.series.label.gt,
          unit = self.get_unit(label);
      var value = self.unit_si(item.datapoint[1], 2, unit),
          sum_value = self.unit_si(
            self.arraybytes(self.deltas[label][graph_type]), null, 'iB'
          ),
          description = self.info[label].name,
          switchname = self.info[label].ip;
      self.find("throughput").val(value);
      self.find("bytes").val(sum_value);
      self.find("description").val(description);
      self.find("switchname").val(switchname);
      // show tooltip
      var tooltip_position = {
        top: item.pageY+5,
        left: Math.min(item.pageX+5, window.innerWidth*0.8)
      };
      $("#tooltip").html(description + ": " + value)
        .css(tooltip_position)
        .fadeIn(200);
      // display information from json file
      if (self.index_mode=="json" && self.deltas[label]['info']) {
        var table = ['<table>'], info = self.deltas[label]['info'],
            ftime = new Date(item.datapoint[0]).toLocaleString();
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
      if (self.index_mode=="mrtg" && self.deltas[label]['html']) {
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
    } else {
      $("#tooltip").hide();
    }
  });
  this.placeholder.bind("plotclick", function(event, pos, item) {
    if (item) {
      var label = item.series.label.name;
      self.div.find(
        "input#cb"+self.ID+label.escapeSelector()
      ).prop(
        "checked", !self.div.find("input#cb"+self.ID+label.escapeSelector()
                    ).prop("checked")
      );
      if (self.groups) {
        for (var srvi in self.groups)
          for (var grpi in self.groups[srvi])
            if (self.groups[srvi][grpi].name==label)
              self.groups[srvi][grpi].enabled = false;
        self.plot_all_graphs();
      } else {
        self.plot_graph();
      }
    }
  });
}

// Add callbacks for graph
Graph.prototype.add_callbacks = function() {
  var self = this;
  // buttons and selectors
  this.interval.change(function() {self.refresh_range()});
  this.graph_source.change(function() {self.change_source()});
  $("select#service").change(function() {
    self.filter.empty(); // checkbox names are different
    self.refresh_graph();
  });
  $("select#host").change(function() {
    self.filter.empty(); // checkbox names are different
    self.refresh_graph();
  });
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
  this.add_plot_callbacks();
}

Graph.prototype.urllink = function() {
  var self = this, ports = [],
      inputs_all = this.filter.find("input"),
      inputs_checked = this.filter.find("input:checked");
  if (this.index_mode=="json") {
    var url = "?j="+this.index_files[0].split(";")[0];
  } else if (this.index_mode=="mrtg") {
    var url = "?m="+this.index_files[0].split(";")[0];
  } else if (this.index_mode=="storage") {
    var url = "?s="+this.index_files[0].split(";")[0];
  } else if (this.index_mode=="nagios") {
    var url = "?n="+this.index_files[0].split(";")[0];
  } else {
    return;
  }
  if (inputs_checked.length<inputs_all.length) {
    inputs_checked.each(function() {
      if (self.index_mode=="storage" || self.index_mode=="nagios") {
        ports.push(this.name);
      } else {
        ports.push(self.info[this.name]["port_id"]);
      }
    });
    if (ports.length>0)
      url += ";" + ports.join(";");
  }
  url += "&i=" + this.interval.val() + "h";
  url += "&u=" + this.unit_type.val();
  window.location = window.location.href.split("?")[0] + url;
}
Graph.prototype.menu_selected = function(sel) {
  var self = this, inputs_all = this.filter.find("input");
  if (sel===undefined) {
    var sel = this.find("menu", "option:selected").val();
  }
  if (sel=="") {
    return;
  } else if (sel=="all") {
    $(inputs_all).prop("checked", true);
    this.plot_graph();
  } else if (sel=="none") {
    $(inputs_all).prop("checked", false);
    this.plot_graph();
  } else if (sel=="inv") {
    $(inputs_all).each(function() {
      var sel = $(this);
      sel.prop("checked", !sel.prop("checked"));
    });
    this.plot_graph();
  } else if (sel=="virtual") {
    $(inputs_all).each(function() {
      var sel = $(this);
      if (self.deltas[this.name]['info']
          && self.deltas[this.name]['info']['ifType']=='propVirtual')
        sel.prop("checked", !sel.prop("checked"));
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

// Keyboard events
Graph.prototype.keyevent = function(event) {
  switch(event.which) {
    case 'X'.charCodeAt(0):
      this.menu_selected("inv");
      break;
    case 'N'.charCodeAt(0):
      this.menu_selected("none");
      break;
    case 'A'.charCodeAt(0):
      this.menu_selected("all");
      break;
    case 'V'.charCodeAt(0):
      this.menu_selected("virtual");
      break;
    case 'R'.charCodeAt(0):
      this.menu_selected("reload");
      break;
    case 'Z'.charCodeAt(0):
      this.menu_selected("zoomout");
      break;
    case 'I'.charCodeAt(0):
      this.find("info_table").animate({height: "toggle"}, 300);
      break;
    case '1'.charCodeAt(0):
      this.interval.val(24);
      this.refresh_range();
      break;
    case '3'.charCodeAt(0):
      this.interval.val(24*3);
      this.refresh_range();
      break;
    case '4'.charCodeAt(0):
      this.interval.val(4);
      this.refresh_range();
      break;
    case '7'.charCodeAt(0):
      this.interval.val(24*7);
      this.refresh_range();
      break;
    case '8'.charCodeAt(0):
      this.interval.val(8);
      this.refresh_range();
      break;
    case '9'.charCodeAt(0):
      this.interval.val(24*8766); // 1 year
      this.refresh_range();
      break;
    case '0'.charCodeAt(0):
      this.interval.val(24*26298); // 3 years
      this.refresh_range();
      break;
    case 39: // right
      this.range_from += this.interval.val()*one_hour;
      this.range_to += this.interval.val()*one_hour;
      this.plot_graph();
      break;
    case 37: // left
      this.range_from -= this.interval.val()*one_hour;
      this.range_to -= this.interval.val()*one_hour;
      this.plot_graph();
      break;
    case 38: // up
      this.range_from -= this.interval.val()*one_hour;
      this.range_to += this.interval.val()*one_hour;
      this.plot_graph();
      break;
    case 40: // down
      var amount = this.interval.val()*one_hour;
      if (this.range_to-this.range_from>amount*2) {
        this.range_from += amount;
        this.range_to -= amount;
        this.plot_graph();
      }
      break;
  }
  if (!event.ctrlKey) {
    if (65<=event.which<=90 || 97<=event.which<=122) {
      event.preventDefault();
    }
  }
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
      this.info[key].name +
      "</td></tr></table></li>");
  }
  self.preselect_graphs = []; // clear after apply
  // Add actions.
  this.filter.find("input").click(function() { self.plot_graph(); });
  this.graph_type.change(function() { self.plot_graph(); });
  this.unit_type.change(function() { self.plot_graph(); });
}

// Plot current graph.
Graph.prototype.plot_all_graphs = function() {
  var graph, enabled_groups;
  if (this.loader.service_groups && this.groups) {
    for (var service in this.loader.service_groups) {
      if (this.loader.service_groups[service].hide===true) continue; // skip
      if (!this.groups[service]) continue;
      graph = $("#graph_"+service);
      if (graph.length==0) {
        graph = $(
          '<div id="graph_'+service+'" class="trafgrapher">' +
            this.loader.service_groups[service].name +
            '<br/>' +
            '<div id="placeholder_'+service+'" class="graph200r"></div>' +
          '</div>'
        );
        $("div#multiple_graphs").append(graph);
      }
      this.placeholder = graph.find("#placeholder_"+service);
      enabled_groups = [];
      for (var grpi in this.groups[service])
        if (this.groups[service][grpi].enabled)
          enabled_groups.push(this.groups[service][grpi].name);
      this.plot_graph(enabled_groups);
      this.add_plot_callbacks();
    }
  } else {
    this.plot_graph();
  }
}
Graph.prototype.plot_graph = function(checked_choices) {
  var flots = [], name, unit,
      graph_type = this.graph_type.find("option:selected").val() || "jo";
  if (checked_choices===undefined) {
    var checked_choices = [];
    this.filter.find("input:checked").each(function() {
      checked_choices.push($(this).prop("name"));
    });
  }
  var colors = gen_colors(checked_choices.length);
  for (var n=0; n<checked_choices.length; n++) {
    name = checked_choices[n];
    unit = this.get_unit(name);
    if (this.index_mode=="storage") {
      if (graph_type[0]=="x") {
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
    } else {
      // mrtg graph
      for (var gt=0; gt<graph_type.length; gt++) {
        if (this.deltas[name][graph_type[gt]]===undefined)
          this.error("Undefined data: "+name+" "+graph_type[gt]);
        flots.push({
          label: {name: name, gt: graph_type[gt]},
          color: String(colors[n]),
          data: this.filter_interval(
                  this.deltas[name][graph_type[gt]], this.info[name].unit,
                  graph_type[gt]==graph_type[gt].toUpperCase()
                )
        })
      }
    }
  }
  this.plot = $.plot(this.placeholder, flots, {
    xaxis: { mode: "time", timezone: "browser" },
    yaxis: {
      tickFormatter: this.unit_si,
      si_unit: unit,
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
    this.div.find(
      "li#li"+this.ID+series[i].label.name.escapeSelector()+" div"
    ).css(
      "background-color", series[i].color.toString()
    ).css(
      "border-color", "black"
    ).css(
      "color", "white"
    );
  }
  // clear last graph values
  this.find("throughput").val("");
  this.find("bytes").val("");
  this.find("description").val("");
  this.find("switchname").val("");
  this.find("info_table").empty();
}

/*
  Data loaders
  =============
*/

Loader = function(graph) {
  this.graph = graph;
  this.graph.loader = this;
  this.tagsrc = graph.graph_source.find("option:selected").val();
  var loading = graph.div.find("[id^=loader]");
  this.progress = loading.find("[id^=progress]");
  this.progress.text("");
  this.files_to_load = 0;
  this.loaded_bytes = 0;
  graph.deltas = {};
  graph.counters = {};
  graph.info = {};
  // show loader
  graph.placeholder.empty();
  graph.placeholder.append(loading);
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
        deltas[name] = {};
        for (var key in this.data_items)
          deltas[name][this.data_items[key]] = [];
      }
      for (var rw in counters[name]) {
        var arrs = [];
        for (var nodeid in counters[name][rw])
          arrs.push(arraydelta(counters[name][rw][nodeid]));
        deltas[name][rw] = joinarrays(arrs);
      }
    }
    if (this.service_groups && this.graph.groups) {
      $("div#multiple_graphs").empty(); // remove old graphs
      this.graph.plot_all_graphs();
    } else {
      this.graph.update_checkboxes();
      this.graph.plot_graph();
    }
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
  ===============
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
    self.graph.info[ethid] = {name: ethid, unit: {b: 'ib/s', B: 'iB/s'}};
    deltas[ethid] = {'o': [], 'i': [], 'j': [], 'O': [], 'I': [], 'J': []};
    // copy args
    for (var key in args) self.graph.info[ethid][key] = args[key];
    lines.shift(); // remove couter line
    lines = lines.map(function(row) {
      return row.split(" ").map(function(col) { return parseInt(col) })
    });
    lines.sort(function(a, b) { return a[0]-b[0] });
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
          self.graph.info[name] = {name: name, unit: {
            o: "io/s", b: "B/s", l: "ms", t: "tr/s"
          }};
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
              self.graph.info[name] = {name: name, unit: {
                o: "io/s", b: "B/s", l: "ms", t: "tr/s"
              }};
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

// Load compellent stats for one file.
StorageLoader.prototype.load_compellent = function(filename) {
  var self = this, counters = this.graph.counters;
  $.ajax({
    url: filename,
    dataType: "xml"
  }).done(function(data) {
    var l2 = data.getElementsByTagName("return")[0].innerHTML;
    var rows = $($('<div/>').html(l2).text()).find("Data").text().split(":");
    var sizeunit = 1024;
    for (var row_id=0; row_id<rows.length; row_id++) {
      if (rows[row_id]=="") continue;
      // Columns: Cpu,InstanceId,InstanceName,IoPending,Memory,
      //   ObjectIndex,ObjectType,PlatformTime,
      //   ReadIos-8,ReadKBs-9,ReadLatency-10,
      //   ScName,ScObjectType,ScSerialNumber,
      //   WriteIos-14,WriteKBs-15,WriteLatency-16
      var cols = rows[row_id].split(",");
      var name = cols[2].replace("Disk ", "");
      var timestamp = cols[7]+"000";
      var ctrl = cols[13]; // controller or SC_serial?
      if (name=="Unknown") continue;
      if (!counters[name]) {
        counters[name] = {};
        for (var key in self.data_items)
          counters[name][self.data_items[key]] = [];
        self.graph.info[name] = {name: name, unit: {
          o: "io/s", b: "B/s", l: "ms", t: "tr/s"
        }};
      }
      // read IO
      if (!counters[name].ro[ctrl]) counters[name].ro[ctrl] = [];
      counters[name].ro[ctrl].push(
        [timestamp, parseInt(cols[8])]);
      // read kB
      if (!counters[name].rb[ctrl]) counters[name].rb[ctrl] = [];
      counters[name].rb[ctrl].push(
        [timestamp, parseInt(cols[9])*sizeunit]);
      // read latency
      if (!counters[name].rl[ctrl]) counters[name].rl[ctrl] = [];
      counters[name].rl[ctrl].push(
        [timestamp, parseInt(cols[10])]);
      // write IO
      if (!counters[name].wo[ctrl]) counters[name].wo[ctrl] = [];
      counters[name].wo[ctrl].push(
        [timestamp, parseInt(cols[14])]);
      // write kB
      if (!counters[name].wb[ctrl]) counters[name].wb[ctrl] = [];
      counters[name].wb[ctrl].push(
        [timestamp, parseInt(cols[15])*sizeunit]);
      // write latency
      if (!counters[name].wl[ctrl]) counters[name].wl[ctrl] = [];
      counters[name].wl[ctrl].push(
        [timestamp, parseInt(cols[16])]);
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
  url = preselect_graphs.shift();
  self.graph.preselect_graphs = preselect_graphs;
  $.ajax({
    url: url,
    cache: false
  }).done(function(data) {
    var files = [];
    if (data[0]=="<")
      var tags = $(data).find("a");
    else
      var tags = data.split("\n");
    var current_datetime = new Date(), interval = self.graph.time_interval;
    for (var tagi=0; tagi<tags.length; tagi++) {
      if (tags[tagi].getAttribute)
        var href = tags[tagi].getAttribute("href");
      else
        var href = tags[tagi];
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
      // Compellent
      if (href.indexOf("Cmpl")==0) {
        if (self.tagsrc=="vdsk" && href[4]!="V") continue;
        if (self.tagsrc=="mdsk" && href[4]!="P") continue;
        if (self.tagsrc=="disk" && href[4]!="D") continue;
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
      } else if (files[fni].indexOf(url+"C")==0) {
        self.load_compellent(files[fni]);
      }
    }
  }).fail(function(jqXHR, textStatus, error) {
    self.graph.error(
      "Failed to load index file: " + url + ": " + error
    );
  });
}

/*
  Nagios perfdata functions
  ==========================
*/

NagiosLoader = function(graph, files) {
  Loader.call(this, graph, files);
}

NagiosLoader.prototype = Object.create(Loader.prototype);

NagiosLoader.prototype.service_groups = {
  load: {
    name: "Load",
    search: /(load\/load|CPU.*utilization\/util)/i,
    unit: ""
  },
  swap: {
    name: "Swap",
    search: /(mem|swap)\/swap/i,
    unit: "B"
  },
  swap_check_mk: {
    name: "Swap",
    search: /memory.*\/pagefile/i,
    unit: "MB"
  },
  mem_total: {
    name: "Memory total",
    hide: true,
    search: /mem\/Total/i,
    unit: "B"
  },
  mem: {
    name: "Memory",
    search: /mem\/./i,
    unit: "B"
  },
  mem_check_mk: {
    name: "Memory",
    search: /memory.*\/memory/i,
    unit: "MB"
  },
  eth: {
    name: "Ethernet [bits]",
    search: /eth.+\/[rt]x_bytes/i,
    reversed: /^rx/,
    unit: "b/s"
  },
  eth_stat: {
    name: "Ethernet packets",
    search: /eth.+\/./i,
    reversed: /^rx/,
    unit: "/s"
  },
  disk_bytes: {
    name: "Disk bytes",
    search: /(diskio_.|Disk%20IO%20SUMMARY)\/(read|write)/i,
    reversed: /^write/,
    unit: "B/s"
  },
  disk_io: {
    name: "Disk IO",
    search: /diskio_.\/(ioread|iowrite)/i,
    reversed: /^iowrite/,
    unit: "io/s"
  },
  diskio_queue: {
    name: "Disk queue",
    hide: true, // wrong data type, change to counter
    search: /diskio_.\/queue/i,
    unit: "/s"
  },
  disk: {
    name: "Disk usage",
    search: /(disk_|fs_[A-Z]:)/i,
    unit: "%"
  },
  users: {
    name: "Users",
    search: /users\/users/i,
    unit: ""
  },
  process: {
    name: "Processes",
    search: /(total|zombie)_procs/i,
    unit: ""
  },
  apache_bytes: {
    name: "Apache bytes",
    search: /apache\/traffic/,
    unit: "B/s"
  },
  apache_requests: {
    name: "Apache requests",
    search: /apache\/(accesses|requests)/,
    unit: "/s"
  },
  apache_states: {
    name: "Apache states",
    search: /apache\/(waiting|reading|sending|closing|dns_lookup)/,
    unit: ""
  },
  mailq: {
    name: "Mail queue",
    search: /mailq\/unsent/i,
    unit: ""
  },
  sql: {
    name: "SQL",
    search: /mysql\/./i,
    unit: "/s"
  },
  ups: {
    name: "UPS",
    search: /(UPS.*|APCUPSD)\/./i,
    unit: ""
  },
  temperature: {
    name: "Temperature",
    search: /Temperature\/temperature/i,
    unit: "C"
  },
  ping_rta: {
    name: "Ping RTA",
    search: /PING\/(rta|rtmin|rtmax)/,
    unit: "ms"
  },
  ping_pl: {
    name: "Ping loss",
    search: /PING\/pl/,
    unit: "%"
  },
  latency: {
    name: "Latency",
    search: /.*\/time$/,
    unit: "ms"
  },
  size: {
    name: "Reply size",
    search: /.*\/size$/,
    unit: "B"
  },
  time_offset: {
    name: "Time offset",
    search: /System.*Time\/offset/i,
    unit: "s"
  },
  uptime: {
    name: "Uptime",
    search: /Uptime\/uptime/i,
    unit: "s"
  },
  check_mk: {
    name: "Check MK",
    search: /Check_MK\/./,
    unit: "ms"
  },
  other: {
    name: "Other",
    search: /./,
    unit: ""
  }
}

// Load perfdata stats for one service label.
NagiosLoader.prototype.load_data = function(filename, service) {
  var self = this, counters = this.graph.counters, deltas = this.graph.deltas,
             filename = filename, service = service;
  $.ajax({
    url: filename,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var rows = data.split("\n"), hdr = rows[0].split("\t"), rw, name, desc;
    if (hdr.length<4) {
      console.log("Wrong header:", filename, hdr);
      return;
    }
    if (hdr[2].search(/^[rt]x_/)>=0) {
      desc = hdr[0]+" "+hdr[1]+" "+hdr[2].substring(3);
      name = (hdr[0]+"_"+hdr[1]+"_"+hdr[2].substring(3)).replace(/[.:\/]/g, "_");
    } else {
      desc = hdr[0]+" "+hdr[1]+" "+hdr[2];
      name = (hdr[0]+"_"+hdr[1]+"_"+hdr[2]).replace(/[.:\/]/g, "_");
    }
    // add group
    if (service!==undefined && self.graph.groups)
      self.graph.groups[service].push({name: name, enabled: true});
    // create deltas
    if (!deltas[name]) {
      deltas[name] = {i: [], j: [], o: []};
      self.graph.info[name] = {name: desc, unit: hdr[3]};
    }
    if (self.service_groups[service])
      self.graph.info[name]["unit"] = self.service_groups[service].unit;
    if (hdr[3]=="c") { // counters
      rw = "o";
      if (service!==undefined && self.service_groups[service] &&
          self.service_groups[service].reversed &&
          hdr[2].search(self.service_groups[service].reversed)>=0)
        rw = "i";
      var value, last_value = null, time, last_time, time_interval;
      for (var rowi=1; rowi<rows.length; rowi++) {
        var cols = rows[rowi].split(" ");
        time = to_ms(cols[0]);
        value = parseFloat(cols[1]);
        if (last_value!==null) {
          // divide by 1000 because time is in miliseconds
          time_interval = (time - last_time)/1000;
          if (value>=last_value) {
            deltas[name][rw].push([time, (value-last_value)/time_interval]);
            if (rw=="i")
              deltas[name]["j"].push([time, (last_value-value)/time_interval]);
          } else {
            last_value = null;
          }
        }
        last_time = time;
        last_value = value;
      }
    } else {
      var percent = hdr[1].search(/^nrpe_disk_/i)==0, max;
      if (percent) max = parseFloat(hdr[7]);
      for (var rowi=1; rowi<rows.length; rowi++) {
        var cols = rows[rowi].split(" ");
        var col1 = parseFloat(cols[1]);
        if (percent) col1 = col1*100/max;
        deltas[name]['o'].push([to_ms(cols[0]), col1]);
      }
    }
    self.loaded_bytes += data.length | 0;
    self.file_loaded();
  });
}

// Load file index and start loading of files.
NagiosLoader.prototype.load_index = function(url) {
  var self = this;
  var preselect_host = url.split(";");
  url = preselect_host.shift();
  $.ajax({
    url: url+"/",
    cache: false
  }).done(function(data) {
    var rows = data.split("\n"), row, urlrow;
    var current_datetime = new Date(), interval = self.graph.time_interval;
    var service = $("select#service option:selected").val();
    var hosts = $("select#host"), host;
    var files = {}
    function files_push(host, service, urlrow) {
      if (!files[host])
        files[host] = {}
      if (!files[host][service])
        files[host][service] = [];
      files[host][service].push(urlrow);
    }
    for (var rowi=0; rowi<rows.length; rowi++) {
      row = rows[rowi].substr(1);
      if (!row) continue; // skip empty lines
      urlrow = url+escape(row);
      host = row.split("/")[1];
      if (service) {
        host = "ALL";
      } else {
        // add host
        if (hosts.find('option[value="'+host+'"]').length==0) {
          if (host==preselect_host)
            var selected = ' selected="selected"';
          else
            var selected = '';
          hosts.append(
            '<option value="'+host+'"'+selected+'>'+host+'</option>'
          );
        }
      }
      // push data
      for (var srvi in self.service_groups) {
        if (row.search(self.service_groups[srvi].search)>=0) {
          files_push(host, srvi, urlrow);
          break;
        }
      }
    }
    // preset unit_type
    if (service=="eth")
      self.graph.unit_type.val("b");
    else
      self.graph.unit_type.val("B");
    self.loaded_bytes += data.length | 0;
    if (service) {
      self.files_to_load += files["ALL"][service].length;
      if (self.files_to_load<=0)
        self.progress.text("No data to load");
      for (var fni=0; fni<self.files_to_load; fni++)
        self.load_data(files["ALL"][service][fni], service);
    } else {
      host = hosts.find('option:selected').val();
      for (var service in files[host])
        self.files_to_load += files[host][service].length;
      if (self.files_to_load<=0)
        self.progress.text("No data to load");
      self.graph.groups = {};
      for (var service in files[host]) {
        self.graph.groups[service] = [];
        for (var fni=0; fni<files[host][service].length; fni++) {
          self.load_data(files[host][service][fni], service);
        }
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
  if (this.index_mode=="storage") {
    this.refresh_graph();
  } else {
    this.reset_range();
    this.plot_all_graphs();
  }
}

Graph.prototype.refresh_graph = function() {
  this.range_from = null;
  this.range_to = null;
  if (this.index_mode=="json") {
    var loader = new JSONLoader(this, this.index_files);
  } else if (this.index_mode=="mrtg") {
    var loader = new MRTGLoader(this, this.index_files);
  } else if (this.index_mode=="storage") {
    var loader = new StorageLoader(this, this.index_files);
  } else if (this.index_mode=="nagios") {
    var loader = new NagiosLoader(this, this.index_files);
  } else {
    this.error("No files to load.");
  }
  if (loader) {
    for (var idx=0; idx<this.index_files.length; idx++)
      loader.load_index(this.index_files[idx]);
  }
}

Graph.prototype.change_source = function() {
  // Remove checkboxes, because new source has different checkboxes.
  this.filter.empty();
  this.refresh_graph();
}

Graph.prototype.zoom_out = function() {
  // Reset zoom
  this.reset_range();
  this.plot_graph();
}

Graph.prototype.select_devices = function() {
  var self = this;
  // skip if files defined for query string
  if (self.index_files.length>0) return;
  this.div.find("[name^=json_file]").each(function() {
    self.index_mode = "json";
    self.index_files.push($(this).val());
  });
  this.div.find("[name^=mrtg_file]").each(function() {
    self.index_mode = "mrtg";
    self.index_files.push($(this).val());
  });
  this.div.find("[name^=storage_file]").each(function() {
    self.index_mode = "storage";
    self.index_files.push($(this).val());
  });
  this.div.find("[name^=nagios_file]").each(function() {
    self.index_mode = "nagios";
    self.index_files.push($(this).val());
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
      } else if (arg[0]=="n") {
        this.index_mode = "nagios";
        split_arg(arg[1], this.index_files);
      } else if (arg[0]=="s") {
        this.index_mode = "storage";
        split_arg(arg[1], this.index_files);
      } else if (arg[0]=="j") {
        this.index_mode = "json";
        split_arg(arg[1], this.index_files);
      } else {
        this.index_mode = "mrtg";
        split_arg(arg[1], this.index_files);
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
    var graph = new Graph($(this).prop("id"));
    graph.parse_query_string();
    graph.refresh_graph();
    $(document).keydown(function(event) {
      graph.keyevent(event);
    });
    graphs.push(graph);
  });
});
