/*
  TrafGrapher
  (c) 2015-2021 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>
  Licensed under the MIT license.
*/

var trafgrapher_version = '3.2.0',
    one_hour = 3600000,
    last_reload = null,
    degreeC = "℃";

// Predefined settings
var excluded_interfaces = [
      // CISCO
      /^unrouted[\ \-]VLAN/,
      /^Control.Plane.Interface/,
      // DELL
      ///^[\ \-]Link[\ \-]Aggregate[\ \-]/,
      /^[\ \-]CPU[\ \-]Interface[\ \-]for[\ \-]/,
      /^Backbone$/
    ];

// Sort by key0
function col0diff(a, b) {
  return a[0]-b[0];
}

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
  a.sort(col0diff);
  return a;
}

// Create array with deltas of two arrays.
// Set time_related=true for time related data (value per second, like b/s)
function arraydelta(nodes, time_related) {
  if (!nodes) return [];
  if (nodes.length===0) return [];
  var deltas = [];
  nodes.sort(col0diff);
  var prev = nodes[0], item, value, time_interval=1;
  for(var i=1; i<nodes.length; i++) {
    item = nodes[i];
    value = item[1]-prev[1];
    // divide by 1000 because time is in miliseconds
    if (time_related)
      time_interval = (item[0]-prev[0])/1000;
    if (value<0) value = 0;
    if (time_interval>0)
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
function guessPrecision(ticksize) {
  if (ticksize<0.01) return 3;
  else if (ticksize<0.1) return 2;
  else if (ticksize<1) return 1;
  return 0;
}
function format_unit(val, axis, unit) {
  var ki = 1024, precision = 3, aval = Math.abs(val), sign = "";
  if (typeof(axis)=="number") precision = axis;
  else if (axis && axis.tickSize) precision = guessPrecision(axis.tickSize);
  if (axis && unit===undefined) unit = axis.options.si_unit;
  if ((unit=="C" || unit==degreeC || unit=="\u00b0C") && val<0) sign = "-";
  if (unit=="") {
    return aval.toFixed(precision);
  }
  if (unit[0]=="W") {
    ki = 1000; // do not use ki for Watts
  }
  if (unit=="ms") {
    aval = aval/1000;
    unit = "s";
  }
  if (unit.indexOf) {
    if (unit.indexOf("³")>=0) {
      ki = 1000*1000*1000;
    } else if (unit.indexOf("²")>=0) {
      ki = 1000*1000;
    }
  }
  // do not display double extensions (kMB)
  if (unit=="kB" || unit=="kiB" || unit=="kb" || unit=="kib" || unit=="kW") {
    unit = unit.substring(1);
    aval = aval * ki;
  } else if (unit=="MB" || unit=="MiB" || unit=="Mb" || unit=="Mib" || unit=="MW") {
    unit = unit.substring(1);
    aval = aval * ki * ki;
  }
  if (unit=="s") {
    if (aval<0.001) {
      if (axis && axis.tickSize)
        precision = guessPrecision(axis.tickSize*1000000);
      return sign+(aval*1000000).toFixed(precision)+" us";
    }
    if (aval<1) {
      if (axis && axis.tickSize)
        precision = guessPrecision(axis.tickSize*1000);
      return sign+(aval*1000).toFixed(precision)+" ms";
    }
    if (aval>3600*24) {
      return sign+(aval/3600/24).toFixed(1)+" d";
    }
    if (aval>3600) {
      return sign+(aval/3600).toFixed(1)+" h";
    }
  } else {
    if (aval>=(ki*ki*ki*ki*ki))
      return sign+(aval/ki/ki/ki/ki/ki).toFixed(precision)+" P"+unit;
    if (aval>=(ki*ki*ki*ki))
      return sign+(aval/ki/ki/ki/ki).toFixed(precision)+" T"+unit;
    if (aval>=(ki*ki*ki))
      return sign+(aval/ki/ki/ki).toFixed(precision)+" G"+unit;
    if (aval>=(ki*ki))
      return sign+(aval/ki/ki).toFixed(precision)+" M"+unit;
    if (aval>=ki)
      return sign+(aval/ki).toFixed(precision)+" k"+unit;
  }
  if (unit && unit[0]=="i" && unit[1]!="o")
    return aval.toFixed(precision)+" "+unit.substr(1);
  return sign+aval.toFixed(precision)+" "+unit;
}

// Parse date and time in format "YYMMHH HHMMSS" into Date object.
function parsedatetime(d, t) {
  if (d.length<8) d = "20" + d;
  return Date.parse(
    d[0]+d[1]+d[2]+d[3]+"-" + d[4]+d[5]+"-" + d[6]+d[7]+"T" +
    t[0]+t[1]+":" + t[2]+t[3]+":" + t[4]+t[5] );
}

// Decode strings
function unbase(data) {
  if (data && data[0]=="~" && window.atob!==undefined)
    return window.atob(data.substr(1));
  return data;
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

    if (i % colorPoolSize === 0 && i) {
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
function light_theme() {
  $('head').append(
    $('<link rel="stylesheet" type="text/css" href="light.css" />'));
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
  this.loaders = [];
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

// Array sum & avg
Graph.prototype.arraysum = function(arr) {
  var value = 0, last = null;
  if (arr.length===0) return 0;
  for (var idx=arr.length-1; idx>=0; idx--) {
    var t = arr[idx][0], v = arr[idx][1];
    if (this.range_from<=t && t<this.range_to && v!==null && !isNaN(v)) {
      if (last===null) last = t;
      value += Math.abs(v)*(t-last)/1000;
      last = t;
    }
  }
  return value;
};
Graph.prototype.arrayavg = function(arr) {
  var value = 0, count = 0, last = null;
  if (arr.length===0) return 0;
  for (var idx=arr.length-1; idx>=0; idx--) {
    var t = arr[idx][0], v = arr[idx][1];
    if (this.range_from<=t && t<this.range_to && v!==null && !isNaN(v)) {
      if (last===null) last = t;
      value += v;
      count += 1;
      last = t;
    }
  }
  if (count===0) return null;
  return value/count;
};

// Get data for current time interval
Graph.prototype.filter_interval = function(data, unit, use_max) {
  var multiply = 1;
  if (unit=="b") multiply = 8; // bits
  var ret = [];
  for (var j=0; j<data.length; j++) {
    if (data[j][0]>=this.range_from && data[j][0]<this.range_to)
      ret.push([data[j][0], data[j][1]*multiply]);
  }
  if (ret.length>2000) {
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
    for (var key in vcnt) {
      if (use_max) {
        ret.push([key*gi, vmax[key]]);
      } else {
        ret.push([key*gi, vsum[key]/vcnt[key]]);
      }
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
  var info = this.info[label];
  if (typeof(info.unit)=="string") {
    if (info.prefer_unit=="b") {
      return info.unit.replace("B", "b");
    } else {
      return info.unit;
    }
  } else if (info.json && info.json.unit) {
    return info.json.unit;
  } else if (this.unit_type && this.unit_type.length>0) {
    return info.unit[this.unit_type.find("option:selected").val()];
  } else if (this.graph_type && this.graph_type.length>0) {
    return info.unit[this.graph_type.find("option:selected").val()[1]];
  }
  return "";
};

// Get color
Graph.prototype.get_color = function(label, n) {
  var info = this.info[label].json;
  if (info && info.color) {
    if (typeof info.color === "number")
      return this.palette[info.color];
    return info.color;
  }
  return this.palette[n];
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
        "li#li"+self.ID+label.escapeSelector()).css(
        "border-color", "black");
      // compute bytes
      var graph_type = item.series.label.gt,
          unit = self.get_unit(label);
      var value = format_unit(item.datapoint[1], 3, unit),
          description = self.info[label].name,
          switchname = self.info[label].ip,
          dt = new Date(item.datapoint[0]),
          sum_value, sum_text;
      if (unit.match(/i[bB]\/s$/)) { // bits per second
        sum_value = self.arraysum(self.deltas[label][graph_type]);
        sum_text = format_unit(sum_value, null, 'iB');
      } else if (unit.match(/\/h$/)) {
        sum_value = self.arraysum(self.deltas[label][graph_type])/3600;
        sum_text = format_unit(sum_value, null, unit.split("/")[0]);
      } else {
        sum_value = self.arrayavg(self.deltas[label][graph_type]);
        sum_text = format_unit(sum_value, null, unit);
      }
      self.find("value_one").val(value);
      self.find("value_sum").val(sum_text);
      if (self.info[label].json && self.info[label].json.price) {
        var data = item.series.data,
            hours = (data[data.length-1][0] - data[0][0]) / 3600000,
            price = self.info[label].json.price * Math.abs(sum_value);
        self.find("value_price").val(price.toFixed(4)+" €");
      }
      self.find("description").val(description);
      self.find("switchname").val(switchname);
      // show tooltip
      var tooltip_position = {
        top: item.pageY+5,
        left: Math.min(item.pageX+5, window.innerWidth*0.8)
      };
      $("#tooltip").html(
          description + "<br/>" + value +
          "<br/>" +
          dt.toDateString() +
          "<br/>" +
          dt.toTimeString()
       ).css(tooltip_position).show();
      // display information from json file
      if (self.index_mode=="json" && self.info[label].json) {
        var table = ['<table>'], info = self.info[label].json,
            ftime = new Date(item.datapoint[0]).toLocaleString();
        table.push("<tr><td>Time</td><td>"+ftime+"</td></tr>");
        for (var key in info) {
          if (key!="log" && typeof info[key]!=="object")
            table.push("<tr><td>"+key+"</td><td>"+info[key]+"</td></tr>");
        }
        table.push("</table>");
        self.find("info_table").html($(table.join('\n')));
      }
      // load table information from MRTG html file
      if (self.index_mode=="mrtg" && self.info[label].html) {
        $.ajax({
          url: self.info[label].html,
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
      $("#tooltip").hide();
      checkbox.prop("checked", !checkbox.prop("checked") );
      if (self.groups) {
        for (var srvi in self.groups) {
          for (var grpi in self.groups[srvi]) {
            if (self.groups[srvi][grpi].name==label)
              self.groups[srvi][grpi].enabled = false;
          }
        }
      }
      self.plot_all_graphs();
      self.urllink();
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
    self.urllink();
  });
};

// Menu functions
Graph.prototype.select_all = function() {
  if (this.groups) {
    // nagios host graph
    for (var srvi in this.groups) {
      for (var grpi in this.groups[srvi]) {
        this.groups[srvi][grpi].enabled = true;
      }
    }
  } else {
    this.filter.find("input").prop("checked", true);
  }
  this.plot_all_graphs();
  this.urllink();
};
Graph.prototype.select_none = function() {
  this.filter.find("input").prop("checked", false);
  this.plot_graph();
  this.urllink();
};
Graph.prototype.select_inv = function() {
  this.filter.find("input").each(function() {
    var sel = $(this);
    sel.prop("checked", !sel.prop("checked"));
  });
  this.plot_graph();
  this.urllink();
};
Graph.prototype.select_virt = function() {
  var self = this;
  this.filter.find("input").each(function() {
    var sel = $(this);
    if (self.deltas[this.name].info &&
        self.deltas[this.name].info.ifType=='propVirtual')
      sel.prop("checked", !sel.prop("checked"));
  });
  this.plot_graph();
  this.urllink();
};

// Add menu callbacks for graph
Graph.prototype.add_menu_callbacks = function() {
  var self = this;
  // buttons and selectors
  this.interval.change(function() {
    self.refresh_range();
    self.urllink();
  });
  this.graph_source.change(function() {
    self.change_source();
    self.urllink();
  });
  $("select#service").change(function() {
    self.filter.empty(); // checkbox names are different
    self.refresh_graph();
    self.urllink();
  });
  $("select#host").change(function() {
    self.filter.empty(); // checkbox names are different
    self.refresh_graph();
    self.urllink();
  });
  this.find("toggle_info").click(function() {
    self.find("info_table").animate({height: "toggle"}, 300);
  });
  this.find("toggle_filter").click(function() {
    self.filter.toggle();
  });
  this.find("hide_graph").click(function() {
    self.placeholder.toggle();
  });
  this.find("b_select_all").click(function() { self.select_all(); });
  this.find("b_select_inv").click(function() { self.select_inv(); });
  this.find("b_select_none").click(function() { self.select_none(); });
  this.find("b_select_virt").click(function() { self.select_virt(); });
  this.find("b_zoom_out").click(function() { self.zoom_out(); });
  this.find("b_reload").click(function() { self.refresh_graph(); });
  this.find("b_urllink").click(function() { self.urllink(); });
};

// Create link args for index files
Graph.prototype.files_to_args = function(prefix, suffix) {
  var self = this, args = "", fn,
      inputs_all = this.filter.find("input"),
      inputs_checked = this.filter.find("input:checked");
  for (var i=0; i<this.index_files.length; i++) {
    if (args!=="") args += "&";
    fn = this.index_files[i];
    fn = fn.split(/[:;]/)[0];
    args += prefix + "=" + fn;
    if (suffix) args += suffix;
    // add list of checked boxes
    var ports = [], index_file;
    if (inputs_checked.length<inputs_all.length) {
      inputs_checked.each(function() {
        if (self.index_mode=="storage" ||
            self.index_mode=="nagios_service" ||
            self.index_mode=="nagios_host" ||
            self.index_mode=="sagator") {
          ports.push(this.name);
        } else {
          index_file = self.index_files[i].split(";")[0];
          if (self.info[this.name].index == index_file) {
            ports.push(self.info[this.name]["port_id"]);
          }
        }
      });
      if (ports.length>0)
        args += ";" + ports.join(";");
    }
  }
  return args;
};

// Update URL link according to current choices
Graph.prototype.urllink = function(force) {
  var self = this, url,
      inputs_all = this.filter.find("input"),
      inputs_checked = this.filter.find("input:checked");
  if (this.index_mode=="json") {
    url = "?"+this.files_to_args("j");
  } else if (this.index_mode=="mrtg") {
    url = "?"+this.files_to_args("m");
  } else if (this.index_mode=="storage") {
    url = "?"+this.files_to_args("s");
  } else if (this.index_mode=="nagios_service") {
    url = "?"+this.files_to_args("n",
               ";"+$("select#service option:selected").val());
  } else if (this.index_mode=="nagios_host") {
    var host = $("select#host option:selected").val();
    url = "?"+this.files_to_args("n", ";"+host).replace("::", ";");
    if (self.groups) {
      var enabled_services = [], all_services = 0;
      for (var srvi in self.groups) {
        for (var grpi in self.groups[srvi]) {
          all_services += 1;
          if (self.groups[srvi][grpi].enabled)
            enabled_services.push(self.groups[srvi][grpi].name);
        }
      }
      if (enabled_services.length<all_services)
        url += ';' + enabled_services.join(";");
    }
  } else {
    return;
  }
  url += "&i=" + this.interval.val() + "h";
  if (this.unit_type.val())
    url += "&u=" + this.unit_type.val();
  if (this.custom_range) {
    url += "&rf=" + this.range_from + "&rt=" + this.range_to;
  }
  if (filter_services.length>0) {
    url += "&filter=" + filter_services.join(';');
  }
  current_url = current_url.split("?")[0] + url;
  if ($("#b_urllink").length>0) {
    // change URL only if urllink button present
    if (history.replaceState) {
      history.replaceState(
        {"params": url},
        url,
        current_url);
    } else if (force===true) {
      window.location = current_url;
    }
  }
};

// Keyboard events
Graph.prototype.keyevent = function(event) {
  var prevent_default = true;
  if (event.ctrlKey || event.altKey) {
    // ignore keyboard keys with alt | ctrl
    return;
  }
  switch(event.which) {
    case 'X'.charCodeAt(0):
      this.select_inv();
      break;
    case 'N'.charCodeAt(0):
      this.select_none();
      break;
    case 'A'.charCodeAt(0):
      this.select_all();
      break;
    case 'V'.charCodeAt(0):
      this.select_virt();
      break;
    case 'R'.charCodeAt(0):
      this.refresh_graph();
      break;
    case 'Z'.charCodeAt(0):
      this.zoom_out();
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
    case '5'.charCodeAt(0):
      this.interval.val(744);
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
    case '2'.charCodeAt(0):
      this.interval.val(24*8766*2); // 2 years
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
    default:
      prevent_default = false;
  }
  //if ((65<=event.which && event.which<=90) || (96<=event.which && event.which<=111)) {
  //console.log(event.which, prevent_default);
  if (prevent_default) {
    event.preventDefault();
    //console.log("prevent", event.which, prevent_default);
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
    if (this.preselect_graphs.length>0) {
      if ($.inArray(key, this.preselect_graphs)<0)
        checked = "";
    }
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
  this.filter.find("input").click(function() {
    self.plot_graph();
    self.urllink();
  });
  this.graph_type.change(function() {
    self.plot_graph();
    self.urllink();
  });
  this.unit_type.change(function() {
    self.plot_graph();
    self.urllink();
  });
};

// Plot current graph.
Graph.prototype.plot_all_graphs = function() {
  var graph, enabled_groups, placeholder;
  if (this.groups) {
    // make menu fixed (always visisble)
    var selection = $("div.selection");
    selection.addClass("noscroll");
    $("div#placeholder").css("margin-top", selection.outerHeight());

    for (var service in service_groups) {
      if (service_groups[service].hide===true) continue; // skip
      if (!this.groups[service]) continue;
      graph = $("#graph_"+service);
      var urllink = '';
      if (filter_services.length==0) {
        urllink = ' <a href="'+current_url+'&filter='+service+
                  '">&UpperRightArrow;</a>';
      }
      if (graph.length===0) {
        graph = $(
          '<div id="graph_'+service+'" class="trafgrapher">' +
            service_groups[service].name + urllink +
            '<br/>' +
            '<div id="placeholder_'+service+'" class="graph200r"></div>' +
          '</div>');
        this.placeholder.append(graph);
        placeholder = graph.find("div#placeholder_"+service);
        this.add_plot_callbacks(placeholder);
      }
      enabled_groups = [];
      for (var grpi in this.groups[service]) {
        if (this.groups[service][grpi].enabled)
          enabled_groups.push(this.groups[service][grpi].name);
      }
      placeholder = graph.find("#placeholder_"+service);
      this.plot_graph(enabled_groups, placeholder);
    }
  } else {
    this.plot_graph();
  }
};

Graph.prototype.plot_graph = function(checked_choices, placeholder) {
  var flots = [], name, unit, color, axis,
      graph_type = this.graph_type.find("option:selected").val() || "jo";
  if (checked_choices===undefined) {
    checked_choices = [];
    this.filter.find("input:checked").each(function() {
      checked_choices.push($(this).prop("name"));
    });
  }
  // main axis on left side
  var multiple_axes = [{
        font: { fill: "#eee" },
        tickFormatter: format_unit,
        //si_unit: "" // redefined below
  }];
  // flot graphs
  this.palette = gen_colors(checked_choices.length);
  var ax_list = [];
  for (var n=0; n<checked_choices.length; n++) {
    name = checked_choices[n];
    unit = this.get_unit(name);
    color = this.get_color(name, n);
    if (this.index_mode=="storage") {
      if (graph_type[0]=="x") {
        // storage read and write graph
        flots.push({
          label: {name: name, gt: 'r'+graph_type[1]},
          color: color,
          data: this.filter_interval(this.deltas[name]['r'+graph_type[1]])
        });
        flots.push({
          label: {name: name, gt: 'w'+graph_type[1]},
          color: color,
          data: this.filter_interval(arrayinverse(
                  this.deltas[name]['w'+graph_type[1]]))
        });
      } else {
        // storage one way graph (read or write only)
        flots.push({
          label: {name: name, gt: graph_type[0]},
          color: color,
          data: this.filter_interval(this.deltas[name][graph_type])
        });
      }
    } else {
      // json/mrtg/nagios graph
      for (var gt=0; gt<graph_type.length; gt++) {
        if (this.deltas[name][graph_type[gt]]===undefined)
          console.log("Undefined data: "+name+" "+graph_type[gt]);
        if (this.deltas[name][graph_type[gt]].length===0)
          continue; // skip empty graph
        this.info[name].prefer_unit =
          this.unit_type.find("option:selected").val();
        if (!this.info[name].prefer_unit &&
            this.info[name].service && this.info[name].service.prefer_bits) {
          this.info[name].prefer_unit = "b";
        }
        // force to Bytes for temperature and some special units
        if (this.info[name].json && this.info[name].json.force_bytes) {
          this.info[name].prefer_unit = "B";
        }
        unit = this.get_unit(name); // refresh unit
        axis = this.info[name].json.yaxis;
        if (axis!==undefined) {
          // copy unit if it's set to True
          if (axis===true) {
            axis = this.info[name].json.unit;
            axis = unit;
            if (ax_list.indexOf(axis)<0)
              ax_list.push(axis);
          }
          multiple_axes.push({
            position: "right",
            alignTicksWithAxis: 1,
            font: { fill: "#eee" },
            tickFormatter: format_unit,
            si_unit: axis
          });
        } else {
          // this looks like default unit
          if (this.info[name].json.unit)
            multiple_axes[0].si_unit = this.info[name].json.unit;
        }
        // add to flots
        flots.push({
          label: {name: name, gt: graph_type[gt]},
          color: String(color),
          yaxis: ax_list.indexOf(axis)+2,
          data: this.filter_interval(
                  this.deltas[name][graph_type[gt]],
                  this.info[name].prefer_unit,
                  graph_type[gt]==graph_type[gt].toUpperCase())
        });
      }
    }
  }
  // set default unit if still not defined
  if (multiple_axes[0].si_unit===undefined)
    multiple_axes[0].si_unit = unit;
  if (placeholder===undefined)
    placeholder = this.placeholder;
  this.plot = $.plot(this.placeholder, flots, {
    xaxis: {
      //position: "bottom",
      font: { fill: "#eee" },
      mode: "time",
      //axisZoom: true, plotZoom: true,
      timezone: "browser",
      timeBase: "milliseconds"
    },
    yaxes: multiple_axes,
    legend: { show: false },
    //zoom: { interactive: true, active: true, enableTouch: true },
    //pan: { interactive: true, active: true, enableTouch: true },
    grid: { hoverable: true, clickable: true },
    series: { lines: { lineWidth: 2 } },
    selection: { mode: "x" }
  });
  // set checkbox colors
  var series = this.plot.getData();
  this.div.find("li div.box").css(
    "background-color", "transparent").css(
    "border-color", "transparent");
  for (var i=0; i<series.length; i++) {
    this.div.find(
      "li#li"+this.ID+series[i].label.name.escapeSelector()+" div").css(
      "background-color", series[i].color.toString()).css(
      "border-color", "black").css(
      "color", "white");
  }
  // clear last graph values
  this.find("value_one").val("");
  this.find("value_sum").val("");
  this.find("value_price").val("");
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
    this.refresh_graph();
  else
    this.plot_all_graphs();
};

Graph.prototype.refresh_graph = function() {
  var loader;
  // stop all loaders
  for (var i=0; i<this.loaders.length; i++) {
    this.loaders.pop().abort();
  }
  if (this.index_mode=="json") {
    loader = new JSONLoader(this, this.index_files);
  } else if (this.index_mode=="mrtg") {
    loader = new MRTGLoader(this, this.index_files);
  } else if (this.index_mode=="storage") {
    loader = new StorageLoader(this, this.index_files);
  } else if (this.index_mode=="nagios_service" ||
             this.index_mode=="nagios_host" ||
             this.index_mode=="sagator") {
    loader = new NagiosLoader(this, this.index_files);
  } else {
    console.log("No files to load.");
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
  this.urllink();
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
  this.div.find("[name^=sagator_file]").each(function() {
    self.index_mode = "sagator";
    self.index_files.push($(this).val());
    console.log($(this).val());
  });
};

Graph.prototype.parse_query_string = function() {
  filter_services = [];
  function split_arg(arg, arr) {
    var sarg = arg.split(",");
    var prefix = "";
    if (sarg[0].search("/")>=0)
      prefix = sarg[0].replace(/[^\/]*\/$/, '');
    arr.push(sarg[0]);
    for (var i=1; i<sarg.length; i++) {
      if (sarg[i].search("/")===0)
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
        if (itag.length===0)
          this.interval.append(
            '<option value="'+arg1+'">'+arg1+' hours</option>');
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
        else if ($("select#service").length>0)
          this.index_mode = "nagios_service";
        else
          this.index_mode = "sagator";
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
      } else if (arg[0]=="filter") {
        filter_services = arg[1].split(';');
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

Progress = function(graph, loader) {
  this.data_loader = loader;
  this.loader_tag = graph.find("loader");
  this.tag = this.loader_tag.find("[id^=progress]");
  this.tag.text("");
  this.files_to_load = 0;
};

Progress.prototype.echo = function() {
  if (this.files_to_load>0) {
    this.tag.html(this.files_to_load+
      " files to load (<a href=\"#\">skip</a>)");
    this.loader_tag.show();
  }
};

Progress.prototype.add = function(files, bytes) {
  this.files_to_load += files;
  this.echo();
  if (files<=0)
    this.progress.text("No data to load!");
};

Progress.prototype.update = function(remaining_files) {
  var self = this;
  if (remaining_files===undefined)
    this.files_to_load -= 1;
  else
    this.files_to_load = remaining_files;
  if (this.files_to_load>0) {
    this.echo();
    this.tag.find("a").click(function() {
      self.update(1); // set last file
      self.data_loader.file_loaded();
      return false;
    });
  } else {
    this.loader_tag.hide();
  }
  return this.files_to_load;
};

Progress.prototype.error = function(msg) {
  var error = this.loader_tag.find("#error");
  if (error.length>0) {
    error.text(msg).show();
  } else {
    console.log(msg);
  }
};

Progress.prototype.loading_error = function(filename, msg) {
  if (msg && msg!="abort")
    this.error("Error loading file " + filename + ": " + msg);
};

/*
  Data loaders
  =============
*/

Loader = function(graph, index_files) {
  this.graph = graph;
  this.index_files = index_files;
  this.progress = new Progress(graph, this);
  this.counters = {};
  graph.deltas = {};
  graph.info = {};
  // set current interval
  if (!graph.range_from || !graph.range_to || graph.custom_range===false)
    graph.reset_range();
  this.graph.placeholder.empty();
};

Loader.prototype.reload = function() {
  for (var idx=0; idx<this.index_files.length; idx++)
    this.load_index(this.index_files[idx]);
  last_reload = new Date();
};

// File loaded, update counter, show graph if all files processed.
Loader.prototype.file_loaded = function() {
  var counters = this.counters, deltas = this.graph.deltas;
  if (this.progress.update()===0) { // last file loaded
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
          arrs.push(arraydelta(counters[name][rw][nodeid], true));
        deltas[name][rw] = joinarrays(arrs);
      }
    }
    if (this.graph.groups) {
      this.graph.placeholder.empty(); // remove old graphs
    } else {
      this.graph.update_checkboxes();
    }
    this.graph.plot_all_graphs();
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
      return row.split(" ").map(function(col) { return parseFloat(col); });
    });
    lines.sort(col0diff);
    for (var line=0; line<lines.length; line++) {
      var cols = lines[line];
      var t = cols[0]*1000,
          ib = cols[1], ob = cols[2],
          im = cols[3], om = cols[4];
      if (cols.length==2) {
        deltas.o.push([t, ib]);
      } else {
        deltas.i.push([t, ib]);
        deltas.j.push([t, -ib]);
        deltas.o.push([t, ob]);
        deltas.I.push([t, im]);
        deltas.J.push([t, -im]);
        deltas.O.push([t, om]);
      }
    }
    if (args.info && args.info.counter)
      for (var key in deltas)
        deltas[key] = arraydelta(deltas[key], false);
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
    var files = [], ethid;
    if (data.ifs) {
      for (var port_id in data.ifs) {
        for (var i in excluded_interfaces) {
          if (data.ifs[port_id].ifDescr.search(excluded_interfaces[i])>=0) {
            port_id = null;
            break;
          }
        }
        if (port_id===null) continue;
        // load only preselected graphs, if first preselect is "!" character
        if (preselect_graphs.length>0
             && preselect_graphs[0]=="!"
             && $.inArray(port_id, preselect_graphs)<0) {
          continue;	// skip non preselected graphs
        }
        ethid = data.ip.replace(/[^a-z0-9]/gi, '_')+port_id.replace(".", "_");
        function get_if_name(ifs) {
          if (ifs[port_id].ifAlias) {
            if (ifs[port_id].ifDescr.match(/^Vlan[0-9]+$/i)) {
              return ifs[port_id].ifAlias+" ["+ifs[port_id].ifDescr+"]";
            } else {
              return ifs[port_id].ifAlias;
            }
          }
          if (data.ifs[port_id].ifDescr=="Ethernet Interface") {
            // linksys
            return data.ifs[port_id].ifDescr + " " + data.ifs[port_id].ifName;
          }
          return data.ifs[port_id].ifDescr;
        }
        files.push({
          'index': url,
          'filename': urldir + data.ifs[port_id].log,
          'port_id': port_id,
          'ethid': ethid,
          'name': get_if_name(data.ifs),
          'ip': data.ip,
          'json': data.ifs[port_id]
        });
        if (preselect_graphs.length>0) {
          if ($.inArray(port_id, preselect_graphs)>=0)
            self.graph.preselect_graphs.push(ethid);
        }
      }
    }
    if (data.oids) {
      //self.graph.unit_type.val("B");
      for (var oid in data.oids) {
        var data_oid = data.oids[oid];
        if (oid===null) continue;
        ethid = data.ip.replace(/[^a-z0-9]/gi, '_') + oid.replace(".", "_");
        files.push({
          'index': url,
          'filename': urldir + data_oid.log,
          'ethid': ethid,
          'port_id': oid,
          'name': data_oid.description || data_oid.name,
          'ip': data.ip,
          'json': data_oid
        });
        if (preselect_graphs.length>0) {
          if ($.inArray(oid, preselect_graphs)>=0)
            self.graph.preselect_graphs.push(ethid);
        }
      }
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
    var files = [], ethid;
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
        for (var i in excluded_interfaces) {
          if (name.search(excluded_interfaces[i])>=0)
            return;
        }
        var file_prefix = url+fname,
            basename = file_prefix.substr(file_prefix.lastIndexOf('/')+1),
            port_id = basename.substr(basename.indexOf('_')+1);
        ethid = switch_ip.replace(/[^a-z0-9]/gi, '_') +
                port_id.replace(".", "_");
        files.push({
          'index': url,
          'filename': file_prefix+".log",
          'port_id': port_id,
          'ethid': basename,
          'name': name,
          'ip': switch_ip,
          'html': file_prefix+".html"
        });
        if (preselect_graphs.length>0) {
          if ($.inArray(port_id, preselect_graphs)>=0)
            self.graph.preselect_graphs.push(basename);
        }
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
        coll.attributes["timestamp"].value.replace(" ", "T"));
      var sizeunit = parseInt(
        coll.attributes["sizeUnits"].value.replace("B", ""));
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
      if (row.indexOf("Name   ")===0) {
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
      } else if (row.indexOf("RAIDGroup ID:")===0) {
        rg = rargs[0];
        if (self.tagsrc=="mdsk") {
          if (!counters[rg]) {
            counters[rg] = {};
            for (key in self.data_items)
              counters[rg][self.data_items[key]] = [];
          }
        }
      } else if (row.indexOf("Statistics logging current time:")===0) {
        var t = rargs[0], d = rargs[1];
        timestamp = Date.parse(
          "20"+d[6]+d[7]+"-"+d[0]+d[1]+"-"+d[3]+d[4]+"T"+t);
      }
      if (name!=="") {
        if (self.tagsrc=="vdsk") {
          if (row.indexOf("Blocks Read")===0) {
            idx = args[2];
            if (!counters[name].rb[idx]) counters[name].rb[idx] = [];
            counters[name].rb[idx].push(
              [timestamp, parseInt(args[14])*sizeunit]);
          } else if (row.indexOf("Blocks Written")===0) {
            idx = args[2];
            if (!counters[name].wb[idx]) counters[name].wb[idx] = [];
            counters[name].wb[idx].push(
              [timestamp, parseInt(args[11])*sizeunit]);
          } else if (row.indexOf("Read Histogram[")===0) {
            hid = args[1][10];
            if (!counters[name].ro[hid]) counters[name].ro[hid] = [];
            counters[name].ro[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Write Histogram[")===0) {
            hid = args[1][10];
            if (!counters[name].wo[hid]) counters[name].wo[hid] = [];
            counters[name].wo[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Average Read Time:")===0) {
            if (!counters[name].rl.one) counters[name].rl.one = [];
            counters[name].rl.one.push([timestamp, parseInt(rargs[0])]);
          } else if (row.indexOf("Average Write Time:")===0) {
            if (!counters[name].wl.one) counters[name].wl.one = [];
            counters[name].wl.one.push([timestamp, parseInt(rargs[0])]);
          }
        } else if (self.tagsrc=="mdsk") {
          if (row.indexOf("Blocks Read")===0) {
            idx = name+args[2];
            if (!counters[rg].rb[idx]) counters[rg].rb[idx] = [];
            counters[rg].rb[idx].push(
              [timestamp, parseInt(args[14])*sizeunit]);
          } else if (row.indexOf("Blocks Written")===0) {
            idx = name+args[2];
            if (!counters[rg].wb[idx]) counters[rg].wb[idx] = [];
            counters[rg].wb[idx].push(
              [timestamp, parseInt(args[11])*sizeunit]);
          } else if (row.indexOf("Read Histogram[")===0) {
            hid = name+args[1][10];
            if (!counters[rg].ro[hid]) counters[rg].ro[hid] = [];
            counters[rg].ro[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Write Histogram[")===0) {
            hid = name+args[1][10];
            if (!counters[rg].wo[hid]) counters[rg].wo[hid] = [];
            counters[rg].wo[hid].push([timestamp, parseInt(args[2])]);
          } else if (row.indexOf("Average Read Time:")===0) {
            if (!counters[rg].rl[name]) counters[rg].rl[name] = [];
            counters[rg].rl[name].push([timestamp, parseInt(rargs[0])]);
          } else if (row.indexOf("Average Write Time:")===0) {
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
    var hdr_cols, rows, l2 = data.getElementsByTagName("return")[0].innerHTML;
    if (l2===undefined) {
      // IE has no innerHTML for this element
      l2 = $($(data.getElementsByTagName("return")).text());
      hdr_cols = l2.find("header").text().split(",");
      rows = l2.find("data").text().split(":");
    } else {
      // HTML processing is very slow in Chrome, replaced by regular expression
      //var rows = $($('<div/>').html(l2).text()).find("Data").text().split(":");
      try {
        hdr_cols = l2.split(/&lt;\/?Header&gt;/)[1].split(",");
        rows = l2.split(/&lt;\/?Data&gt;/)[1].split(":");
      } catch(err) {
        console.log("Failed to load:", filename);
        self.file_loaded();
        return;
      }
    }
    // index headers
    for (var i in hdr_cols)
      hdr_cols[hdr_cols[i]] = i;
    var sizeunit = 1024;
    for (var row_id=0; row_id<rows.length; row_id++) {
      if (rows[row_id]==="") continue;
      // Columns: Cpu,InstanceId,InstanceName,IoPending,Memory,
      //   ObjectIndex,ObjectType,PlatformTime,
      //   ReadIos-8,ReadKBs-9,ReadLatency-10,
      //   ScName,ScObjectType,ScSerialNumber,
      //   WriteIos-14,WriteKBs-15,WriteLatency-16
      var cols = rows[row_id].split(",");
      var name = cols[hdr_cols.InstanceName].replace("Disk ", "");
      var timestamp = cols[hdr_cols.PlatformTime]+"000";
      var ctrl = cols[hdr_cols.ScSerialNumber]; // controller or SC_serial?
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
        [timestamp, parseInt(cols[hdr_cols.ReadIos])]);
      // read kB
      if (!counters[name].rb[ctrl]) counters[name].rb[ctrl] = [];
      counters[name].rb[ctrl].push(
        [timestamp, parseInt(cols[hdr_cols.ReadKBs])*sizeunit]);
      // read latency
      if (!counters[name].rl[ctrl]) counters[name].rl[ctrl] = [];
      counters[name].rl[ctrl].push(
        [timestamp, parseInt(cols[hdr_cols.ReadLatency])]);
      // write IO
      if (!counters[name].wo[ctrl]) counters[name].wo[ctrl] = [];
      counters[name].wo[ctrl].push(
        [timestamp, parseInt(cols[hdr_cols.WriteIos])]);
      // write kB
      if (!counters[name].wb[ctrl]) counters[name].wb[ctrl] = [];
      counters[name].wb[ctrl].push(
        [timestamp, parseInt(cols[hdr_cols.WriteKBs])*sizeunit]);
      // write latency
      if (!counters[name].wl[ctrl]) counters[name].wl[ctrl] = [];
      counters[name].wl[ctrl].push(
        [timestamp, parseInt(cols[hdr_cols.WriteLatency])]);
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
      if (href.indexOf("N"+self.tagsrc[0]+"_stats_")===0) {
        hrefa = href.split("_");
        d = hrefa[3];
        t = hrefa[4];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push(url+href);
      }
      // Unisphere
      if (href.indexOf("Uni_")===0) {
        hrefa = href.split("_");
        d = hrefa[hrefa.length-2];
        t = hrefa[hrefa.length-1];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push(url+href);
      }
      // Compellent
      if (href.indexOf("Cmpl")===0) {
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
      if (files[fni].indexOf(url+"N")===0) {
        self.load_storwize(files[fni]);
      } else if (files[fni].indexOf(url+"U")===0) {
        self.load_unisphere(files[fni]);
      } else if (files[fni].indexOf(url+"C")===0) {
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
    search: /load\/load1$/,
    unit: "",
    hide: true,
    next: true
  },
  load5: {
    name: "Load 5",
    search: /load\/load5$/,
    unit: "",
    hide: true,
    next: true
  },
  load15: {
    name: "Load 15",
    search: /load\/load15$/,
    unit: "",
    hide: true,
    next: true
  },
  load: {
    name: "Load",
    search: /(load\/load|CPU.*utilization\/)/i,
    unit: ""
  },
  swap: {
    name: "Swap",
    search: /(mem|swap)\/swap/i,
    unit: "B",
    hide: true,
    next: true
  },
  swap_check_mk: {
    name: "Swap",
    search: /memory.*\/pagefile/i,
    unit: "MB",
    hide: true,
    next: true
  },
  mem_total: {
    name: "Memory total",
    search: /mem.*\/.*Total/i,
    unit: "B",
    hide: true
  },
  mem: {
    name: "Memory",
    // all memory object except PageIn/PageOut processed below
    search: /mem\/(?!Page)./i,
    unit: "B",
    next: true
  },
  mem_paging: {
    name: "Memory paging",
    // process below mem to display in better order
    search: /mem.*\/Page/,
    join_by: /^(PageIn|PageOut)/,
    join_desc: "Page Out/In ",
    reversed: /^PageIn/,
    unit: "B",
    next: false
  },
  mem_duplicates: {
    // Paging should be displayed after base data, which must be hidden
    // here to avoid dislpying in other.
    name: "Memory hidden duplicates",
    search: /mem\/./i,
    unit: "B",
    next: false,
    hide: true
  },
  mem_check_mk: {
    name: "Memory",
    search: /memory.*\/(memory|pagefile)/i,
    unit: "MB"
  },
  eth_io: {
    name: "Ethernet [bits]",
    search: /((eth|tun).+\/[rt]x_bytes|Interface [0-9]+\/(in|out)$)/i,
    join_by: /^(rx_|tx_|in|out)/,
    join_desc: "tx/rx ",
    reversed: /^(rx|in)/,
    unit: "B/s",
    prefer_bits: true
  },
  eth_stat: {
    name: "Ethernet packets",
    search: /((eth|tun).+|Interface [0-9]+)\/./i,
    join_by: /^(rx|tx|in|out)_/,
    join_desc: "tx/rx ",
    reversed: /^(rx|in)/,
    unit: "/s"
  },
  disk_bytes: {
    name: "Disk bytes",
    search: /(diskio_.\/(read|write)|Disk.*IO.*SUMMARY\/(read|write|disk_read_throughput|disk_write_throughput))/i,
    join_by: /(read|write)/,
    join_desc: "read/write ",
    reversed: /write/,
    unit: "B/s"
  },
  disk_blocks: {
    name: "Disk IO blocks",
    search: /(diskio_.|Disk.*IO.*SUMMARY)\/(ioread|iowrite|disk_read_ios|disk_write_ios)/i,
    join_by: /(read|write)/, // do not use ioread/iowrite
    join_desc: "read/write ",
    reversed: /^(iowrite|disk_write_ios)/,
    unit: "io/s"
  },
  diskio_queue: {
    name: "Disk queue",
    search: /(diskio_.|Disk.*IO.*SUMMARY)\/(queue|disk_read_ql|disk_write_ql)/i,
    unit: "/s"
  },
  disk_usage_percent: {
    name: "Disk usage %",
    search: /(disk_|fs_[A-Z]:\/)/i,
    unit: "%",
    convert: function(value, warn, crit, min, max) {
      return value*100/max;
    },
    name_suffix: "_percent",
    next: true
  },
  disk_usage: {
    name: "Disk usage bytes",
    search: /(disk_|fs_[A-Z]:\/)/i
    //unit: "B"
  },
  disk_usage_other: {
    // other data from check_mk
    name: "Disk usage other",
    search: /fs_[A-Z]:\/\/(fs_size|growth|trend)/,
    unit: "",
    hide: true
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
  php_fpm_states: {
    name: "PHP-FPM",
    search: /php-fpm/,
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
    search: /temperature.*\/(temp|dew|humidity)/i,
    unit: degreeC
  },
  ping_rta: {
    name: "Ping RTA",
    search: /PING\/(rta|rtmin|rtmax)/,
    unit: "s"
  },
  ping_pl: {
    name: "Ping loss",
    search: /PING\/pl/,
    unit: "%"
  },
  latency: {
    name: "Latency",
    search: /.*\/time$/,
    unit: "s"
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
    unit: "s"
  },
  // psacct
  sa: {
    name: "psacct",
    search: /_sa\/./,
    unit: ""
  },
  // sagator
  sagator_count: {
    name: "Sagator email count",
    search: /sagator\/(total|clean|spam|virus)-count/,
    unit: "/s"
  },
  sagator_policy_count: {
    name: "Sagator policy count",
    search: /sagator\/.*-count/,
    unit: "/s"
  },
  sagator_bytes: {
    name: "Sagator email bytes",
    search: /sagator\/.*-bytes/,
    unit: "B/s"
  },
  sagator_time: {
    name: "Sagator time",
    search: /sagator\/.*-time/,
    unit: "/s"
  },
  // other
  other: {
    name: "Other",
    search: /./
  }
};

// Load perfdata stats for one service label.
NagiosLoader.prototype.load_data = function(filename, service) {
  var self = this;
  return $.ajax({
    url: filename,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var value, cols, rows = data.split("\n"), rowi, hdr = rows[0].split("\t"),
        rw, name, desc, service_group, lunit = hdr[3], multiplier = 1,
        warn=null, crit=null, min=null, max=null;
    function is_enabled(name) {
      return self.graph.preselect_graphs.length==0 ||
             self.graph.preselect_graphs.indexOf(name)>=0;
    }
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
      desc = desc + hdr[2].replace(service_group.join_by,
                                   service_group.join_desc || "");
    } else {
      desc = desc + hdr[2];
    }
    name = desc.replace(/[ .:\/]/g, "_");
    if (service_group.name_suffix)
      name += service_group.name_suffix;
    // add group
    if (service!==undefined && self.graph.groups)
      self.graph.groups[service].push({name: name, enabled: is_enabled(name)});
    // create info
    if (!self.graph.info[name])
      self.graph.info[name] = {name: desc, unit: lunit, service: service_group};
    if (lunit=="MB") {
      multiplier = 1048576;
      self.graph.info[name].unit = "B";
    } else if (lunit=="ms" || lunit=="mV") {
      multiplier = 0.001;
      self.graph.info[name].unit = lunit[1];
    }
    if (service_group.unit!==undefined)
      self.graph.info[name].unit = service_group.unit;
    if (service_group.convert) {
      warn = parseFloat(hdr[4])*multiplier;
      crit = parseFloat(hdr[5])*multiplier;
      min = parseFloat(hdr[6])*multiplier;
      max = parseFloat(hdr[7])*multiplier;
    }
    rw = "o";
    if (service_group.reversed && hdr[2].search(service_group.reversed)>=0)
      rw = "i";
    if (!self.graph.deltas[name])
      self.graph.deltas[name] = {i: [], j: [], o: []};
    if (hdr[3]=="c") { // counters
      // create counters
      var counters = []; // use local counters
      for (rowi=1; rowi<rows.length; rowi++) {
        if (!rows[rowi]) continue; // ignore empty lines
        cols = rows[rowi].split(" ");
        value = parseFloat(cols[1])*multiplier;
        if (service_group.convert)
          value = service_group.convert(value, warn, crit, min, max);
        counters.push([to_ms(cols[0]), value]);
      }
      // compute deltas
      self.graph.deltas[name][rw] = arraydelta(counters, true);
    } else {
      // create deltas
      for (rowi=1; rowi<rows.length; rowi++) {
        if (!rows[rowi]) continue; // skip empty line
        cols = rows[rowi].split(" ");
        value = parseFloat(cols[1])*multiplier;
        if (service_group.convert)
          value = service_group.convert(value, warn, crit, min, max);
        self.graph.deltas[name][rw].push([to_ms(cols[0]), value]);
      }
      self.graph.deltas[name][rw].sort(col0diff);
    }
    if (rw=="i")
      self.graph.deltas[name].j = arrayinverse(self.graph.deltas[name].i);
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
        '<option value="'+preselect+'" selected="selected">' +
        preselect+'</option>');
    }
  }
  $.ajax({
    url: url+"/",
    cache: false
  }).done(function(data) {
    var rows = data.split("\n"), row, urlrow, derow, unrow, selected, fni,
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
      unrow = row.split("/").map(unbase).join("/");
      urlrow = url+escape(row);
      host = row.split("/")[1];
      if (self.graph.index_mode=="sagator") {
        unrow = '/sagator'+unrow;
        host = 'sagator';
      }
      if (service) {
        host = "ALL";
      } else {
        // add host
        if (hosts.find('option[value="'+host+'"]').length===0) {
          if (host==preselect)
            selected = ' selected="selected"';
          else
            selected = '';
          hosts.append(
            '<option value="'+host+'"'+selected+'>'+host+'</option>');
        }
      }
      // push data
      for (var srvi in service_groups) {
        if (unrow.search(service_groups[srvi].search)>=0) {
          files_push(host, srvi, urlrow);
          if (service_groups[srvi].next!==true) break;
        }
      }
    }
    // preset unit_type
    if (service_groups[service]) {
      if (service_groups[service].prefer_bits)
        self.graph.unit_type.val("b");
      else
        self.graph.unit_type.val("B");
    }
    if (service) {
      self.progress.add(files[host][service].length);
      for (fni=0; fni<files[host][service].length; fni++)
        self.graph.loaders.push(
          self.load_data(files[host][service][fni], service));
    } else {
      if (self.graph.index_mode=="sagator") {
        host = 'sagator';
      } else {
        host = hosts.find('option:selected').val();
      }
      self.graph.groups = {};
      for (service in files[host]) {
        // ignore filtered services
        if (filter_services.length>0 && filter_services.indexOf(service)<0)
          continue;
        self.graph.groups[service] = [];
        for (fni=0; fni<files[host][service].length; fni++) {
          var fname = files[host][service][fni].split('/').pop();
          if (preselect_graphs.length>0) {
            if (self.graph.index_mode=="nagios_service") {
              if (preselect_graphs.indexOf(fname)<0)
                continue;
            }
          }
          self.progress.add(1);
          self.graph.loaders.push(
            self.load_data(files[host][service][fni], service));
        }
      }
    }
  }).fail(function(jqXHR, textStatus, error) {
    self.progress.loading_error(url, error);
  });
};

// call function on all graphs
function callgraphs(fx) {
  for (var i in graphs) {
    graphs[i][fx]();
  }
}

$(function() {
  var graph_id_counter = 0;
  current_url = window.location.href;
  $(".footer a").text(
    $(".footer a").text().replace("#.#", trafgrapher_version));

  // create graph for multigraph pages
  $('div[class^="trafgrapher_conf"]').each(function(index, div) {
    var div = $(div);
    var graph_id = div.attr("id");
    var template_name = div.attr("class").replace("trafgrapher_conf", "trafgrapher_template");
    var template = $("div."+template_name).clone();
    if (!graph_id) {
      graph_id_counter += 1;
      graph_id = graph_id_counter;
    } else {
      graph_id = graph_id.replace("graph", "");
    }
    template = $(template);
    var template_id = template.attr("id").replace("graph", "");
    template.find("h2").text(div.find("h2").text());
    template.find("div.selection").prepend(div.find("input"));
    // replace element IDs
    template.find("[id$='"+template_id+"']").each(function(index, element) {
      $(element).attr("id", $(element).attr("id").replace(template_id, graph_id));
    });
    // attach to current div
    div.attr("id", "graph"+graph_id);
    div.attr("class", "trafgrapher");
    div.empty();
    template.children().appendTo(div);
  });
  // remove used template
  $('div[class^="trafgrapher_template"]').remove();

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
