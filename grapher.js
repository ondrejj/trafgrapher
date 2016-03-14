/*
  TrafGrapher
  (c) 2015-2016 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>
  Licensed under the MIT license.
*/

var trafgrapher_version = '2.0beta',
    one_hour = 3600000,
    last_reload = null;

// Predefined settings
var excluded_interfaces = [
      // CISCO
      /^unrouted[\ \-]VLAN/,
      /^Control.Plane.Interface/,
      // DELL
      /^[\ \-]Link[\ \-]Aggregate[\ \-]/,
      /^[\ \-]CPU[\ \-]Interface[\ \-]for[\ \-]Unit:[\ \-]/,
      /^Backbone$/
    ];

// Join two arrays into one. For same keys sum values.
function joinarrays(arr) {
  var d = {}, i, key;
  if (arr[0]) {
    for (i=0; i<arr[0].length; i++) {
      key = arr[0][i][0];
      d[key] = arr[0][i][1];
    }
  }
  for (var arr_id=1; arr_id<arr.length; arr_id++) {
    if (arr[arr_id]) {
      for (i=0; i<arr[arr_id].length; i++) {
        key = arr[arr_id][i][0];
        if (d[key]===undefined) d[key] = 0;
        d[key] += arr[arr_id][i][1];
      }
    }
  }
  var a = [];
  for (key in d) {
    a.push([key, d[key]]);
  }
  a.sort(function (a,b) {
    return a[0]-b[0];
  });
  return a;
}

// Create array with deltas of two arrays.
function arraydelta(nodes) {
  if (!nodes) return [];
  if (nodes.length==0) return [];
  var deltas = [];
  nodes.sort(function (a,b) {
    return a[0]-b[0];
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

// Convert unit to kilo, mega, giga or tera.
function unit_si(val, axis, unit) {
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

// Dark theme
function dark_theme() {
  $('head')
    .append($('<link rel="stylesheet" type="text/css" href="dark.css" />'));
}

// Escape selector ID
String.prototype.escapeSelector = function() {
  return this.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g,'\\$1');
};

/*
  Graph object
  =============
*/

var Graph = function(ID) {
  this.ID = ID;
  this.div = $("div#"+ID);
  this.deltas = {}; this.info = {};
  this.index_mode = "json";
  this.index_files = [];
  this.plot = null;
  this.range_from = null; this.range_to = null; this.custom_range = false;
  this.preselect_graphs = [];
  this.placeholder = this.div.find("[id^=placeholder]");
  this.filter = this.div.find("[id^=filter]");
  this.interval = this.div.find("[id^=interval]");
  this.graph_source = this.div.find("[id^=graph_source]");
  this.graph_type = this.div.find("[id^=graph_type]");
  this.unit_type = this.div.find("[id^=unit_type]");
  this.add_menu_callbacks();
};

Graph.prototype.find = function(id, selectors) {
  var sel = "[id^="+id+"]";
  if (selectors===undefined) {
    return this.div.find(sel);
  } else {
    return this.div.find(sel+" "+selectors);
  }
};

// Array bytes
Graph.prototype.arraybytes = function(arr) {
  var bytes = 0, last = null;
  if (arr.length==0) return 0;
  for (var idx=arr.length-1; idx>=0; idx--) {
    var t = arr[idx][0];
    if (this.range_from<=t && t<this.range_to && arr[idx][1]!=undefined) {
      if (last===null) last = t;
      bytes += Math.abs(arr[idx][1])*(t-last)/1000;
      last = t;
    }
  }
  return bytes;
};

// Get data for current time interval
Graph.prototype.filter_interval = function(data, unit, use_max) {
  var ret = [];
  var multiply = 1;
  if (unit=="b") multiply = 8; // bits
  for (var j=0; j<data.length; j++)
    if (data[j][0]>=this.range_from && data[j][0]<this.range_to)
      ret.push([data[j][0], data[j][1]*multiply]);
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
};

// Reset range
Graph.prototype.reset_range = function() {
  // set current interval
  var current_datetime = new Date(),
      range_end = this.div.find("[name^=range_end]").val(),
      time_interval = parseInt(this.interval.val());
  if (range_end) current_datetime = range_end * 1000;
  this.custom_range = false;
  this.range_from = Number(current_datetime - time_interval*one_hour);
  this.range_to = Number(current_datetime); // convert to number
};

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
};

// Add callbacks for plot
Graph.prototype.add_plot_callbacks = function(placeholder) {
  var self = this;
  // hover
  placeholder.unbind("plothover");
  placeholder.bind("plothover", function(event, pos, item) {
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
      var value = unit_si(item.datapoint[1], 2, unit),
          sum_value = unit_si(
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
        .show();
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
          dataType: "html"
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
  // click
  placeholder.unbind("plotclick");
  placeholder.bind("plotclick", function(event, pos, item) {
    if (item) {
      var label = item.series.label.name,
          checkbox = self.div.find("input#cb"+self.ID+label.escapeSelector());
      checkbox.prop("checked", !checkbox.prop("checked") );
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
  // selection
  placeholder.unbind("plotselected");
  placeholder.bind("plotselected", function (event, ranges) {
    // zoom
    self.custom_range = true;
    self.range_from = ranges.xaxis.from;
    self.range_to = ranges.xaxis.to;
    self.plot.clearSelection();
    self.plot_all_graphs();
  });
};

// Add menu callbacks for graph
Graph.prototype.add_menu_callbacks = function() {
  var self = this;
  // buttons and selectors
  this.interval.change(function() { self.refresh_range(); });
  this.graph_source.change(function() { self.change_source(); });
  $("select#service").change(function() {
    self.filter.empty(); // checkbox names are different
    self.refresh_graph();
  });
  $("select#host").change(function() {
    self.filter.empty(); // checkbox names are different
    self.refresh_graph();
  });
  this.find("menu").change(function() { self.menu_selected(); }).val("");
  this.find("toggle_info").click(function() {
    self.find("info_table").animate({height: "toggle"}, 300);
  });
  this.find("toggle_filter").click(function() {
    self.filter.toggle();
  });
};

// Update URL link according to current choices
Graph.prototype.urllink = function() {
  var self = this, ports = [], url,
      inputs_all = this.filter.find("input"),
      inputs_checked = this.filter.find("input:checked");
  if (this.index_mode=="json") {
    url = "?j="+this.index_files[0].split(";")[0];
  } else if (this.index_mode=="mrtg") {
    url = "?m="+this.index_files[0].split(";")[0];
  } else if (this.index_mode=="storage") {
    url = "?s="+this.index_files[0].split(";")[0];
  } else if (this.index_mode=="nagios_service") {
    url = "?n="+this.index_files[0].split(";")[0]
        + ";"+$("select#service option:selected").val();
  } else if (this.index_mode=="nagios_host") {
    url = "?n="+this.index_files[0].replace("::", ";").split(";")[0]
        + ";"+$("select#host option:selected").val();
  } else {
    return;
  }
  if (inputs_checked.length<inputs_all.length) {
    inputs_checked.each(function() {
      if (self.index_mode=="storage" ||
          self.index_mode=="nagios_service" ||
          self.index_mode=="nagios_host") {
        ports.push(this.name);
      } else {
        ports.push(self.info[this.name]["port_id"]);
      }
    });
    if (ports.length>0)
      url += ";" + ports.join(";");
  }
  url += "&i=" + this.interval.val() + "h";
  if (this.unit_type.val())
    url += "&u=" + this.unit_type.val();
  if (this.custom_range) {
    url += "&rf=" + this.range_from + "&rt=" + this.range_to;
  }
  window.location = window.location.href.split("?")[0] + url;
};

// Menu commands
Graph.prototype.menu_selected = function(sel) {
  var self = this, inputs_all = this.filter.find("input");
  if (sel===undefined)
    sel = this.find("menu", "option:selected").val();
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
};

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
      this.custom_range = true;
      this.range_from += this.interval.val()*one_hour;
      this.range_to += this.interval.val()*one_hour;
      this.plot_all_graphs();
      break;
    case 37: // left
      this.custom_range = true;
      this.range_from -= this.interval.val()*one_hour;
      this.range_to -= this.interval.val()*one_hour;
      this.plot_all_graphs();
      break;
    case 38: // up
      this.custom_range = true;
      this.range_from -= this.interval.val()*one_hour;
      this.range_to += this.interval.val()*one_hour;
      this.plot_all_graphs();
      break;
    case 40: // down
      var amount = this.interval.val()*one_hour;
      if (this.range_to-this.range_from>amount*2) {
        this.custom_range = true;
        this.range_from += amount;
        this.range_to -= amount;
        this.plot_all_graphs();
      }
      break;
  }
  if (!event.ctrlKey) {
    if (65<=event.which<=90 || 97<=event.which<=122) {
      event.preventDefault();
    }
  }
};

// Update checkboxes according to number of graphs.
Graph.prototype.update_checkboxes = function() {
  var self = this;
  // Skip updating filter checkboxes if at least one of them is checked.
  // All checkboxes are unchecked when switching graph source to allow
  // update.
  if (this.filter.find("input:checked").length>0) return;
  this.filter.empty();
  var keys = [], key, keyid, idkey, checked;
  for (key in this.deltas) keys.push(key);
  keys.sort();
  for (keyid in keys) {
    key = keys[keyid];
    idkey = this.ID+key;
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
};

// Plot current graph.
Graph.prototype.plot_all_graphs = function() {
  var graph, enabled_groups;
  if (this.groups) {
    for (var service in service_groups) {
      if (service_groups[service].hide===true) continue; // skip
      if (!this.groups[service]) continue;
      graph = $("#graph_"+service);
      if (graph.length==0) {
        graph = $(
          '<div id="graph_'+service+'" class="trafgrapher">' +
            service_groups[service].name +
            '<br/>' +
            '<div id="placeholder_'+service+'" class="graph200r"></div>' +
          '</div>'
        );
        this.placeholder.append(graph);
        var placeholder = graph.find("div#placeholder_"+service);
        this.add_plot_callbacks(placeholder);
      }
      enabled_groups = [];
      for (var grpi in this.groups[service])
        if (this.groups[service][grpi].enabled)
          enabled_groups.push(this.groups[service][grpi].name);
      var placeholder = graph.find("#placeholder_"+service);
      this.plot_graph(enabled_groups, placeholder);
    }
  } else {
    this.plot_graph();
  }
};

Graph.prototype.plot_graph = function(checked_choices, placeholder) {
  var flots = [], name, unit,
      graph_type = this.graph_type.find("option:selected").val() || "jo";
  if (checked_choices===undefined) {
    checked_choices = [];
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
        });
        flots.push({
          label: {name: name, gt: 'w'+graph_type[1]},
          color: colors[n],
          data: this.filter_interval(arrayinverse(
                  this.deltas[name]['w'+graph_type[1]]))
        });
      } else {
        // storage one way graph (read or write only)
        flots.push({
          label: {name: name, gt: graph_type[0]},
          color: colors[n],
          data: this.filter_interval(this.deltas[name][graph_type])
        });
      }
    } else {
      // json/mrtg/nagios graph
      for (var gt=0; gt<graph_type.length; gt++) {
        if (this.deltas[name][graph_type[gt]]===undefined)
          console.log("Undefined data: "+name+" "+graph_type[gt]);
        flots.push({
          label: {name: name, gt: graph_type[gt]},
          color: String(colors[n]),
          data: this.filter_interval(
                  this.deltas[name][graph_type[gt]],
                  this.unit_type.find("option:selected").val(),
                  graph_type[gt]==graph_type[gt].toUpperCase()
                )
        });
      }
    }
  }
  if (placeholder===undefined) placeholder = this.placeholder;
  this.plot = $.plot(placeholder, flots, {
    xaxis: { mode: "time", timezone: "browser" },
    yaxis: {
      tickFormatter: unit_si,
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
};

/*
  Common functions
  =================
*/

Graph.prototype.refresh_range = function() {
  this.reset_range();
  if (this.index_mode=="storage")
    this.refresh_graph()
  else
    this.plot_all_graphs();
};

Graph.prototype.refresh_graph = function() {
  var loader;
  if (this.index_mode=="json") {
    loader = new JSONLoader(this, this.index_files);
  } else if (this.index_mode=="mrtg") {
    loader = new MRTGLoader(this, this.index_files);
  } else if (this.index_mode=="storage") {
    loader = new StorageLoader(this, this.index_files);
  } else if (this.index_mode=="nagios_service" ||
             this.index_mode=="nagios_host") {
    loader = new NagiosLoader(this, this.index_files);
  } else {
    this.error("No files to load.");
  }
  if (loader) loader.reload();
};

Graph.prototype.change_source = function() {
  // Remove checkboxes, because new source has different checkboxes.
  this.filter.empty();
  this.refresh_graph();
};

Graph.prototype.zoom_out = function() {
  // Reset zoom
  this.reset_range();
  this.plot_all_graphs();
};

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
    if ($("select#host").length>0)
      self.index_mode = "nagios_host";
    else
      self.index_mode = "nagios_service";
    self.index_files.push($(this).val());
  });
};

Graph.prototype.parse_query_string = function() {
  function split_arg(arg, arr) {
    var sarg = arg.split(",");
    var prefix = "";
    if (sarg[0].search("/")>=0)
      prefix = sarg[0].replace(/[^\/]*\/$/, '');
    arr.push(sarg[0]);
    for (var i=1; i<sarg.length; i++) {
      if (sarg[i].search("/")==0)
        arr.push(sarg[i]);
      else
        arr.push(prefix+sarg[i]);
    }
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
      } else if (arg[0]=="rf") {
        this.custom_range = true;
        this.range_from = Number(arg[1]);
      } else if (arg[0]=="rt") {
        this.custom_range = true;
        this.range_to = Number(arg[1]);
      } else if (arg[0]=="n") {
        if ($("select#host").length>0)
          this.index_mode = "nagios_host";
        else
          this.index_mode = "nagios_service";
        split_arg(arg[1], this.index_files);
      } else if (arg[0]=="s") {
        this.index_mode = "storage";
        split_arg(arg[1], this.index_files);
      } else if (arg[0]=="j") {
        this.index_mode = "json";
        split_arg(arg[1], this.index_files);
      } else if (arg[0]=="m") {
        this.index_mode = "mrtg";
        split_arg(arg[1], this.index_files);
      } else {
        alert("Unknown argument: "+arg[0]+"="+arg[1]);
        break;
      }
    }
  }
  this.select_devices();
};

/*
  Progress indicator
  ===================
*/

Progress = function(graph) {
  this.loader = graph.find("loader");
  this.tag = this.loader.find("[id^=progress]");
  this.tag.text("");
  this.files_to_load = 0;
};

Progress.prototype.echo = function() {
  if (this.files_to_load>0) {
    this.tag.html(this.files_to_load+
      " files to load (<a href=\"#\">skip</a>)"
    );
    this.loader.show();
  }
};

Progress.prototype.add = function(files, bytes) {
  this.files_to_load += files;
  this.echo();
  if (files<=0)
    this.progress.text("No data to load!");
};

Progress.prototype.update = function(remaining_files) {
  if (remaining_files===undefined)
    this.files_to_load -= 1;
  else
    this.files_to_load = remaining_files;
  if (this.files_to_load>0) {
    this.echo();
    var self = this;
    this.tag.find("a").click(function() {
      self.file_loaded(0);
      return false;
    });
  } else {
    this.loader.hide();
  }
  return this.files_to_load;
};

Progress.prototype.error = function(msg) {
  var error = this.loader.find("#error");
  if (error.length>0) {
    error.text(msg).show();
  } else {
    console.log(msg);
  }
};

Progress.prototype.loading_error = function(filename, msg) {
  if (msg)
    this.error("Error loading file " + filename + ": " + msg);
};

/*
  Data loaders
  =============
*/

Loader = function(graph, index_files) {
  this.graph = graph;
  //this.graph.loader = this;
  this.index_files = index_files;
  this.progress = new Progress(graph);
  this.counters = {};
  graph.deltas = {};
  graph.info = {};
  // set current interval
  if (!graph.range_from || !graph.range_to)
    graph.reset_range();
  this.graph.placeholder.empty();
};

Loader.prototype.reload = function() {
  for (var idx=0; idx<this.index_files.length; idx++)
    this.load_index(this.index_files[idx]);
  last_reload = new Date();
};

// File loaded, update counter, show graph if all files processed.
Loader.prototype.file_loaded = function(remaining_files) {
  var counters = this.counters, deltas = this.graph.deltas;
  if (this.progress.update()==0) { // last file loaded
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
    if (this.graph.groups) {
      this.graph.placeholder.empty(); // remove old graphs
      this.graph.plot_all_graphs();
    } else {
      this.graph.update_checkboxes();
      this.graph.plot_graph();
    }
  }
};

// Old browser support
if (!Object.create) {
  Object.create = function(proto) {
    function f() {}
    f.prototype = proto;
    return new f();
  };
}

/*
  JSON functions
  ===============
*/

JSONLoader = function(graph, index_files) {
  Loader.call(this, graph, index_files);
};

JSONLoader.prototype = Object.create(Loader.prototype);

// Load log file.
JSONLoader.prototype.load_log = function(filename, args) {
  var self = this;
  $.ajax({
    url: filename,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var ethid = args.ethid, lines = data.split('\n');
    name = $('<div/>').text(args.name).html(); // escape html in name
    var deltas = {'o': [], 'i': [], 'j': [], 'O': [], 'I': [], 'J': []};
    lines.shift(); // remove couter line
    lines = lines.filter(function(row) {
      return row[0]; // filter out empty values
    }).map(function(row) {
      return row.split(" ").map(function(col) { return parseInt(col); });
    });
    lines.sort(function(a, b) { return a[0]-b[0]; });
    for (var line=0; line<lines.length; line++) {
      var cols = lines[line];
      var t = cols[0]*1000,
          ib = cols[1], ob = cols[2],
          im = cols[3], om = cols[4];
      deltas.i.push([t, ib]);
      deltas.j.push([t, -ib]);
      deltas.o.push([t, ob]);
      deltas.I.push([t, im]);
      deltas.J.push([t, -im]);
      deltas.O.push([t, om]);
    }
    self.graph.deltas[ethid] = deltas;
    // create info and copy args
    self.graph.info[ethid] = {name: ethid, unit: {b: 'ib/s', B: 'iB/s'}};
    for (var key in args) self.graph.info[ethid][key] = args[key];
    self.file_loaded();
  }).fail(function(jqXHR, textStatus, error) {
    self.progress.loading_error(filename, error);
  });
};

// Load json index and start loading of files.
JSONLoader.prototype.load_index = function(url) {
  var self = this;
  // load index file
  var preselect_graphs = url.split(";");
  url = preselect_graphs.shift();
  var urldir = url.replace(/[^\/]*$/, "");
  this.graph.preselect_graphs = [];
  $.ajax({
    url: url,
    dataType: "json",
    cache: false
  }).done(function(data) {
    var files = [];
    for (var port_id in data.ifs) {
      for (var i in excluded_interfaces)
        if (data.ifs[port_id].ifDescr.search(excluded_interfaces[i])>=0) {
          port_id = null;
          break;
        }
      if (port_id===null) continue;
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
          self.graph.preselect_graphs.push(ethid);
    }
    self.progress.add(files.length, data.length);
    for (var fni=0; fni<files.length; fni++)
      self.load_log(files[fni]["filename"], files[fni]);
  }).fail(function(jqXHR, textStatus, error) {
    self.progress.loading_error(url, error);
  });
};

/*
  MRTG functions
  ===============
*/

MRTGLoader = function(graph, index_files) {
  Loader.call(this, graph, index_files);
};

MRTGLoader.prototype = Object.create(JSONLoader.prototype);

// Load file index and start loading of files.
MRTGLoader.prototype.load_index = function(url) {
  var self = this;
  // loading separate log file?
  if (url.search(/\.log$/)>0) {
    self.progress.add(1);
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
  this.graph.preselect_graphs = [];
  $.ajax({
    url: url,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var files = [];
    // don't load images from index.html
    var noimgdata = data.replace(/\ src=/gi, " nosrc=");
    $(noimgdata).find("td").each(function(tagi, taga) {
      var tag = $(taga), diva = tag.find("div a");
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
        for (var i in excluded_interfaces)
          if (name.search(excluded_interfaces[i])>=0)
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
            self.graph.preselect_graphs.push(ethid);
      }
    });
    self.progress.add(files.length, data.length);
    for (var fni=0; fni<files.length; fni++)
      self.load_log(files[fni]["filename"], files[fni]);
  }).fail(function(jqXHR, textStatus, error) {
    self.progress.loading_error(url, error);
  });
};

/*
  Storage functions
  ==================
*/

StorageLoader = function(graph, index_files) {
  Loader.call(this, graph, index_files);
  this.tagsrc = graph.graph_source.find("option:selected").val();
};

StorageLoader.prototype = Object.create(Loader.prototype);

// Load storwize stats for one file.
StorageLoader.prototype.load_storwize = function(filename) {
  var self = this, counters = this.counters;
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
          if (rw=="rt") srw = "ctr";
          else if (rw=="wt") srw = "ctw";
          else srw = rw;
          if (dsk.attributes[srw]) {
            value = parseInt(dsk.attributes[srw].value);
            if (rw=="rb" || rw=="wb") value *= sizeunit;
            counters[name][rw][nodeid].push([timestamp, value]);
          }
        }
      }
    }
    self.file_loaded();
  });
};

// Load unisphere stats for one file.
StorageLoader.prototype.load_unisphere = function(filename) {
  var self = this, counters = this.counters;
  $.ajax({
    url: filename
  }).done(function(data) {
    var rows = data.split("\n");
    var name = "", lun="", rg="", timestamp, sizeunit=512;
    for (var row_id=0; row_id<rows.length; row_id++) {
      var row = rows[row_id], args = row.split(" "), rargs = args.slice(),
          hid, idx, key;
      rargs.reverse();
      if (row.indexOf("Name   ")==0) {
        if (rargs[1]!="LUN") {
          name = rargs[0];
          if (self.tagsrc=="vdsk") {
            if (!counters[name]) {
              counters[name] = {};
              for (key in self.data_items)
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
            for (key in self.data_items)
              counters[rg][self.data_items[key]] = [];
          }
        }
      } else if (row.indexOf("Statistics logging current time:")==0) {
        var t = rargs[0], d = rargs[1];
        timestamp = Date.parse(
          "20"+d[6]+d[7]+"-"+d[0]+d[1]+"-"+d[3]+d[4]+"T"+t
        );
      }
      if (name!="") {
        if (self.tagsrc=="vdsk") {
          if (row.indexOf("Blocks Read")==0) {
            idx = args[2];
            if (!counters[name].rb[idx]) counters[name].rb[idx] = [];
            counters[name].rb[idx].push(
              [timestamp, parseInt(args[14])*sizeunit]);
          } else if (row.indexOf("Blocks Written")==0) {
            idx = args[2];
            if (!counters[name].wb[idx]) counters[name].wb[idx] = [];
            counters[name].wb[idx].push(
              [timestamp, parseInt(args[11])*sizeunit]);
          } else if (row.indexOf("Read Histogram[")==0) {
            hid = args[1][10];
            if (!counters[name].ro[hid]) counters[name].ro[hid] = [];
            counters[name].ro[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Write Histogram[")==0) {
            hid = args[1][10];
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
            idx = name+args[2];
            if (!counters[rg].rb[idx]) counters[rg].rb[idx] = [];
            counters[rg].rb[idx].push(
              [timestamp, parseInt(args[14])*sizeunit]);
          } else if (row.indexOf("Blocks Written")==0) {
            idx = name+args[2];
            if (!counters[rg].wb[idx]) counters[rg].wb[idx] = [];
            counters[rg].wb[idx].push(
              [timestamp, parseInt(args[11])*sizeunit]);
          } else if (row.indexOf("Read Histogram[")==0) {
            hid = name+args[1][10];
            if (!counters[rg].ro[hid]) counters[rg].ro[hid] = [];
            counters[rg].ro[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Write Histogram[")==0) {
            hid = name+args[1][10];
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
    self.file_loaded();
  });
};

// Load compellent stats for one file.
StorageLoader.prototype.load_compellent = function(filename) {
  var self = this, counters = this.counters;
  $.ajax({
    url: filename,
    dataType: "xml"
  }).done(function(data) {
    var l2 = data.getElementsByTagName("return")[0].innerHTML;
    // HTML processing is very slow in Chrome, replaced by regular expression
    //var rows = $($('<div/>').html(l2).text()).find("Data").text().split(":");
    var rows = l2.split(/&lt;\/?Data&gt;/)[1].split(":");
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
    self.file_loaded();
  });
};

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
    var files = [], tags, hrefa, href, d, t;
    if (data[0]=="<")
      tags = $(data).find("a");
    else
      tags = data.split("\n");
    var current_datetime = new Date(),
        interval = parseInt(self.graph.interval.val());
    for (var tagi=0; tagi<tags.length; tagi++) {
      if (tags[tagi].getAttribute)
        href = tags[tagi].getAttribute("href");
      else
        href = tags[tagi];
      if (href[href.length-1]=="/") continue;
      // Storwize
      if (href.indexOf("N"+self.tagsrc[0]+"_stats_")==0) {
        hrefa = href.split("_");
        d = hrefa[3];
        t = hrefa[4];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push(url+href);
      }
      // Unisphere
      if (href.indexOf("Uni_")==0) {
        hrefa = href.split("_");
        d = hrefa[hrefa.length-2];
        t = hrefa[hrefa.length-1];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push(url+href);
      }
      // Compellent
      if (href.indexOf("Cmpl")==0) {
        if (self.tagsrc=="vdsk" && href[4]!="V") continue;
        if (self.tagsrc=="mdsk" && href[4]!="P") continue;
        if (self.tagsrc=="disk" && href[4]!="D") continue;
        hrefa = href.split("_");
        d = hrefa[hrefa.length-2];
        t = hrefa[hrefa.length-1];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push(url+href);
      }
    }
    self.progress.add(files.length, data.length);
    for (var fni=0; fni<files.length; fni++) {
      if (files[fni].indexOf(url+"N")==0) {
        self.load_storwize(files[fni]);
      } else if (files[fni].indexOf(url+"U")==0) {
        self.load_unisphere(files[fni]);
      } else if (files[fni].indexOf(url+"C")==0) {
        self.load_compellent(files[fni]);
      }
    }
  }).fail(function(jqXHR, textStatus, error) {
    self.progress.loading_error(url, error);
  });
};

/*
  Nagios perfdata functions
  ==========================
*/

NagiosLoader = function(graph, index_files) {
  Loader.call(this, graph, index_files);
};

NagiosLoader.prototype = Object.create(Loader.prototype);

service_groups = {
  load1: {
    name: "Load 1",
    hide: true,
    search: /load\/load1$/,
    unit: "",
    next: true
  },
  load5: {
    name: "Load 5",
    hide: true,
    search: /load\/load5$/,
    unit: "",
    next: true
  },
  load15: {
    name: "Load 15",
    hide: true,
    search: /load\/load15$/,
    unit: "",
    next: true
  },
  load: {
    name: "Load",
    search: /(load\/load|CPU.*utilization\/util)/i,
    unit: ""
  },
  swap: {
    name: "Swap",
    hide: true,
    search: /(mem|swap)\/swap/i,
    unit: "B",
    next: true
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
  eth_io: {
    name: "Ethernet [bits]",
    search: /eth.+\/[rt]x_bytes/i,
    join_by: /^[rt]x_/,
    reversed: /^rx/,
    unit: "b/s"
  },
  eth_stat: {
    name: "Ethernet packets",
    search: /eth.+\/./i,
    join_by: /^[rt]x_/,
    reversed: /^rx/,
    unit: "/s"
  },
  disk_bytes: {
    name: "Disk bytes",
    search: /(diskio_.|Disk.*IO.*SUMMARY)\/(read|write)/i,
    join_by: /(read|write)/,
    reversed: /^write/,
    unit: "B/s"
  },
  disk_blocks: {
    name: "Disk IO blocks",
    search: /diskio_.\/(ioread|iowrite)/i,
    join_by: /(read|write)/, // do not use ioread/iowrite
    reversed: /^iowrite/,
    unit: "io/s"
  },
  diskio_queue: {
    name: "Disk queue",
    hide: true, // wrong data type, change to counter
    search: /diskio_.\/queue/i,
    unit: "/s"
  },
  disk_usage: {
    name: "Disk usage",
    search: /(disk_|fs_[A-Z]:)/i,
    unit: "%",
    convert: function(value, warn, crit, min, max) {
      return value*100/max;
    }
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
    search: /\/(UPS.*|APCUPSD)\/./i,
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
    search: /./
  }
};

// Load perfdata stats for one service label.
NagiosLoader.prototype.load_data = function(filename, service) {
  var self = this;
  $.ajax({
    url: filename,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var value, cols, rows = data.split("\n"), hdr = rows[0].split("\t"),
        rw, name, desc, service_group, lunit = hdr[3], multiplier = 1, rowi;
    if (service_groups[service])
      service_group = service_groups[service];
    else
      service_group = service_groups.other;
    if (hdr.length<4) {
      console.log("Wrong header:", filename, hdr);
      return;
    }
    desc = hdr[0] + " " + hdr[1] + " ";
    if (service_group.join_by) {
      desc = desc + hdr[2].replace(service_group.join_by, "");
    } else {
      desc = desc + hdr[2];
    }
    name = desc.replace(/[ .:\/]/g, "_");
    // add group
    if (service!==undefined && self.graph.groups)
      self.graph.groups[service].push({name: name, enabled: true});
    // create info
    if (!self.graph.info[name])
      self.graph.info[name] = {name: desc, unit: lunit};
    if (lunit=="MB") {
      multiplier = 1048576;
      self.graph.info[name].unit = "B";
    } else if (lunit=="ms" || lunit=="mV") {
      multiplier = 0.001;
      self.graph.info[name].unit = lunit[1];
    }
    if (service_group.unit!==undefined)
      self.graph.info[name].unit = service_group.unit;
    if (hdr[3]=="c") { // counters
      rw = "o";
      if (service_group.reversed && hdr[2].search(service_group.reversed)>=0)
        rw = "i";
      // create counters
      var counters = []; // use local counters
      for (rowi=1; rowi<rows.length; rowi++) {
        cols = rows[rowi].split(" ");
        value = parseFloat(cols[1])*multiplier;
        counters.push([to_ms(cols[0]), value]);
      }
      // compute deltas
      if (!self.graph.deltas[name])
        self.graph.deltas[name] = {i: [], j: [], o: []};
      self.graph.deltas[name][rw] = arraydelta(counters);
      if (rw=="i")
        self.graph.deltas[name].j = arrayinverse(arraydelta(counters));
    } else {
      // create deltas
      var warn=null, crit=null, min=null, max=null;
      if (service_group.convert) {
        warn = parseFloat(hdr[4])*multiplier;
        crit = parseFloat(hdr[5])*multiplier;
        min = parseFloat(hdr[6])*multiplier;
        max = parseFloat(hdr[7])*multiplier;
      }
      if (!self.graph.deltas[name])
        self.graph.deltas[name] = {i: [], j: [], o: []};
      for (rowi=1; rowi<rows.length; rowi++) {
        cols = rows[rowi].split(" ");
        value = parseFloat(cols[1])*multiplier;
        if (service_group.convert)
          value = service_group.convert(value, warn, crit, min, max);
        self.graph.deltas[name]['o'].push([to_ms(cols[0]), value]);
      }
    }
    self.file_loaded();
  }).fail(function(jqXHR, textStatus, error) {
    self.progress.loading_error(filename, error);
  });
};

// Load file index and start loading of files.
NagiosLoader.prototype.load_index = function(url) {
  var self = this;
  var preselect_graphs = url.replace("::", ";").split(";");
  url = preselect_graphs.shift();
  var preselect = preselect_graphs.shift(); // or undefined
  self.graph.preselect_graphs = preselect_graphs;
  // change service selection
  if (this.graph.index_mode=="nagios_service" && preselect) {
    if ($("select#service option[value="+preselect+"]").length>0) {
      if (last_reload===null)
        $("select#service").val(preselect);
    } else if (service_groups[preselect]!==undefined) {
      $("select#service").append(
        '<option value="'+preselect+'" selected="selected">'
        +preselect+'</option>'
      );
    }
  }
  $.ajax({
    url: url+"/",
    cache: false
  }).done(function(data) {
    var rows = data.split("\n"), row, urlrow, selected, fni,
        current_datetime = new Date(),
        service = $("select#service option:selected").val(),
        hosts = $("select#host"), host, files = {};
    function files_push(host, service, urlrow) {
      if (!files[host])
        files[host] = {};
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
          if (host==preselect)
            selected = ' selected="selected"';
          else
            selected = '';
          hosts.append(
            '<option value="'+host+'"'+selected+'>'+host+'</option>'
          );
        }
      }
      // push data
      for (var srvi in service_groups) {
        if (row.search(service_groups[srvi].search)>=0) {
          files_push(host, srvi, urlrow);
          if (service_groups[srvi].next!==true) break;
        }
      }
    }
    // preset unit_type
    if (service_groups[service]) {
      var unit = service_groups[service].unit;
      if (unit=="b" || unit=="b/s")
        self.graph.unit_type.val("b");
      else
        self.graph.unit_type.val("B");
    }
    if (service) {
      self.progress.add(files["ALL"][service].length);
      for (fni=0; fni<files["ALL"][service].length; fni++)
        self.load_data(files["ALL"][service][fni], service);
    } else {
      host = hosts.find('option:selected').val();
      for (service in files[host])
        self.progress.add(files[host][service].length);
      self.graph.groups = {};
      for (service in files[host]) {
        self.graph.groups[service] = [];
        for (fni=0; fni<files[host][service].length; fni++) {
          self.load_data(files[host][service][fni], service);
        }
      }
    }
  }).fail(function(jqXHR, textStatus, error) {
    self.progress.loading_error(url, error);
  });
};

$(function() {
  $(".footer a")
    .text($(".footer a").text().replace("#.#", trafgrapher_version));
  graphs = [];
  $("div[id^=graph]").each(function() {
    var graph = new Graph($(this).prop("id"));
    graph.parse_query_string();
    graph.refresh_graph();
    var placeholder = graph.find("placeholder");
    graph.add_plot_callbacks(placeholder);
    $(document).keydown(function(event) {
      if (event.target.tagName.toLowerCase()=="body")
        graph.keyevent(event);
    });
    graphs.push(graph);
  });
});
