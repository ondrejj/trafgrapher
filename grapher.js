/*
  trafgrapher
  version 0.7
  (c) 2015 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>
  Licensed under the MIT license.
*/

// Global variables
var deltas = {}, counters = {}, data_items = [],
    mrtg_files = [], storage_files = [], files_to_load = -1,
    plot = null, range_from, range_to,
    one_hour = 3600000, units = "iB/s",
    range_multiplier = {y: 8766, m: 744, w: 168, d: 24};

var excluded_interfaces = [
  // CISCO
  /^unrouted-VLAN-/,
  // DELL
  /^-Link-Aggregate-/,
  /^-CPU-Interface-for-Unit:-/,
  /^Unit:-/,
  /^Backbone$/,
];

// Set/unset all input choices.
function setall() {
  if ($("#choices input").length == $("#choices input:checked").length) {
    $("#choices input").attr("checked", false);
  } else {
    $("#choices input").attr("checked", true);
  }
  plot_graph();
  return false;
}

// Convert unit to kilo, mega, giga or tera.
function kilomega(val, axis, unit) {
  var k = 1024, precision = 2, aval = Math.abs(val);
  if (axis && axis.tickDecimals) precision = axis.tickDecimals;
  if (typeof(axis)=="number") precision = axis;
  if (unit==undefined) unit = units;
  if (unit=="ms") {
    if (aval>=k) return (aval/k).toFixed(precision)+" s";
  } else {
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
function arraybytes(arr) {
  var bytes = 0, last = null;
  if (arr.length==0) return 0;
  for (var idx=arr.length-1; idx>=0; idx--) {
    var t = arr[idx][0];
    if (range_from<=t && t<range_to && arr[idx][1]!=undefined) {
      if (last==null) last = t;
      bytes += Math.abs(arr[idx][1])*(t-last)/1000;
      last = t;
    }
  }
  return bytes;
}

// Get data for current time interval
function filter_interval(data, unit, use_max) {
  var ret = [];
  var multiply = 1;
  if (unit=="b") multiply = 8; // bits
  for (i=0; i<data.length; i++)
    if (data[i][0]>=range_from && data[i][0]<range_to)
      ret.push([data[i][0], data[i][1]*multiply]);
  if (ret.length>400) {
    // group data
    var min_t = ret[0][0], max_t = ret[ret.length-1][0];
    var vsum = [], vcnt = [], vmax = [], gi = Math.abs(max_t-min_t)/400;
    for (i=0; i<ret.length; i++) {
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
  for (i = 0; i < neededColors; i++) {
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

// Plot current graph.
function plot_graph() {
  var flots = [];
  var placeholder = $("#graph");
  var graph_type = $("#graph_type option:selected").attr("value");
  var unit = $("#units option:selected").attr("value");
  if (unit===undefined) {
    var all_units = {
      'b': "B/s",
      'o': "io/s",
      'l': "ms",
      't': "tr/s",
    };
    if (graph_type[1] in all_units) {
      units = all_units[graph_type[1]];
    } else {
      units = "";
    }
  } else {
    units = 'i'+unit+"/s";
  }
  if ($("#choices input").length == $("#choices input:checked").length) {
    $("#all_none").attr("value", "NONE");
  } else {
    $("#all_none").attr("value", "ALL");
  }
  var checked_choices = $("#choices").find("input:checked");
  var colors = gen_colors(checked_choices.length);
  checked_choices.each(function (n, choice) {
    var name = $(choice).attr("name");
    if (mrtg_files.length>0) {
      // mrtg graph
      for (var grapht=0; grapht<graph_type.length; grapht++) {
        flots.push({
          //label: graph_type[grapht]+"_"+name,
          label: {name: name, gt: graph_type[grapht]},
          color: colors[n],
          data: filter_interval(
                  deltas[name][graph_type[grapht]], unit,
                  graph_type[grapht]==graph_type[grapht].toUpperCase()
                )
        })
      }
    } else if (graph_type[0]=="x") {
      // storage read and write graph
      flots.push({
        label: {name: name, gt: 'r'+graph_type[1]},
        color: colors[n],
        data: filter_interval(deltas[name]['r'+graph_type[1]])
      })
      flots.push({
        label: {name: name, gt: 'w'+graph_type[1]},
        color: colors[n],
        data: filter_interval(arrayinverse(deltas[name]['w'+graph_type[1]]))
      })
    } else {
      // storage one way graph (read or write only)
      flots.push({
        label: {name: name, gt: graph_type[0]},
        color: colors[n],
        data: filter_interval(deltas[name][graph_type])
      })
    }
  });
  plot = $.plot(placeholder, flots, {
    xaxis: { mode: "time", timezone: "browser" },
    yaxis: {
      tickFormatter: kilomega,
      tickDecimals: 1
    },
    legend: { show: false },
    grid: { hoverable: true, clickable: true },
    selection: { mode: "x" }
  });
  // set checkbox colors
  var series = plot.getData();
  $("li div.box").css("background-color", "transparent"
    ).css("border-color", "transparent");
  for (var i=0; i<series.length; i++) {
    $("li#li"+series[i].label.name+" div").css(
      "background-color", series[i].color.toString()).css(
      "border-color", "black").css(
      "color", "white");
  }
  // clear last graph values
  $("#throughput").attr("value", "");
  $("#bytes").attr("value", "");
  $("#ifname").attr("value", "");
  $("#switchname").attr("value", "");
  $("#info_table").empty();
}

// Add callbacks for graph
function add_callbacks() {
  var placeholder = $("#graph");
  // selection
  placeholder.bind("plotselected", function (event, ranges) {
    // zoom
    range_from = ranges.xaxis.from;
    range_to = ranges.xaxis.to;
    plot.clearSelection();
    plot_graph();
  });
  // hover and click
  placeholder.bind("plothover", function(event, pos, item) {
    if (item) {
      var label = item.series.label.name;
      $("ul#choices li").css("border-color", "transparent");
      $("ul#choices li#li"+label).css("border-color", "black");
      $("#throughput").attr("value", kilomega(item.datapoint[1], 2));
      // compute bytes
      var graph_type = item.series.label.gt;
      $("#bytes").attr("value",
        kilomega(arraybytes(deltas[label][graph_type]), null, 'iB'));
      $("#ifname").attr("value", deltas[label]['name']);
      $("#switchname").attr("value",
        deltas[label]['ip']
      );
      // load table information from MRTG html file
      $.ajax({
        url: deltas[label]['html'],
        dataType: "html",
      }).done(function(data) {
        // don't load images from .html
        var noimgdata = data.replace(/ src=/gi, " nosrc=");
        var table = $(noimgdata).find("table");
        $("#info_table").html(table[0]);
      });
    }
  });
  placeholder.bind("plotclick", function(event, pos, item) {
    if (item) {
      var label = item.series.label.name;
      $("input#cb"+label).attr("checked",
        !$("input#cb"+label).prop("checked")
      );
      plot_graph();
    }
  });
}

// Update checkboxes according to number of graphs.
function update_checkboxes() {
  var choiceContainer = $("#choices");
  if (choiceContainer.find("input:checked").length>0) return;
  choiceContainer.empty();
  var keys = [];
  for (var key in deltas) keys.push(key);
  keys.sort();
  for (var keyid in keys) {
    var key = keys[keyid];
    choiceContainer.append("<li id='li" + key +
      "'><table><tr>" +
      "<td><div class='box'>&nbsp;</div></td>" +
      "<td><input type='checkbox' name='" + key +
        "' checked='checked' id='cb" + key + "'></input></td><td>" +
      //"<label for='cb" + key + "'>" + deltas[key]['name'] + "</label>" +
      deltas[key]['name'] +
      "</td></tr></table></li>");
  }
  $("#choices").find("input").click(plot_graph);
  $("#graph_type").change(plot_graph);
  $("#units").change(plot_graph);
}

/*
  MRTG functions
  ===============
*/

// Load MRTG stats for one file.
function load_mrtg_log(filename, name, switch_ip, switch_url) {
  $.ajax({
    url: filename,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var basename = filename.substr(filename.lastIndexOf('/')+1);
    var port_id = basename.substr(basename.indexOf('_')+1);
    var ethid = switch_ip.replace(/[^a-z0-9]/gi, '_')
              + port_id.replace(/\.log$/, '').replace(".", "_");
    var lines = data.split('\n');
    name = $('<div/>').text(name).html(); // escape html in name
    deltas[ethid] = {
      'name': name, 'url': switch_url, 'ip': switch_ip,
      'html': filename.replace(/\.log$/, '.html'),
      'o': [], 'i': [], 'j': [], //'t': [], 'd': [],
      'O': [], 'I': [], 'J': [], //'T': [], 'D': []
    };
    for (var line=1; line<lines.length; line++) {
      var cols = lines[line].split(' ');
      var t = parseInt(cols[0])*1000,
          ib = parseInt(cols[1]), ob = parseInt(cols[2]),
          im = parseInt(cols[3]), om = parseInt(cols[4]);
      deltas[ethid]['i'].push([t, ib]);
      deltas[ethid]['j'].push([t, -ib]);
      deltas[ethid]['o'].push([t, ob]);
      deltas[ethid]['I'].push([t, im]);
      deltas[ethid]['J'].push([t, -im]);
      deltas[ethid]['O'].push([t, om]);
    }
    files_to_load -= 1;
    $("#progress").text(files_to_load+" files to load");
    if (files_to_load<=0) {
      update_checkboxes();
      plot_graph();
    }
  }).fail(function(jqXHR, textStatus, error) {
    $("#error").text(
      "Failed to load log file: " + filename + ": " + error);
    $("#error").show();
  });
}

// Load file index and start loading of files.
function load_mrtg_index(switch_url) {
  $("#graph").empty();
  $("#graph").append(loader);
  $("#progress").text("");
  $.ajax({
    url: switch_url,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var files = [];
    deltas = {};
    var current_datetime = new Date();
    var interval = parseInt($("#interval").attr("value"));
    range_from = Number(current_datetime - interval*one_hour);
    range_to = Number(current_datetime); // convert to number
    // don't load images from index.html
    var noimgdata = data.replace(/ src=/gi, " nosrc=");
    $(noimgdata).find("td").each(function(tagi, tag) {
      var tag = $(tag);
      var diva = tag.find("div a");
      if (diva[0]) {
        var href = diva.attr("href");
        var fname = href.substr(0, href.lastIndexOf("."));
        switch_url = switch_url.replace(/[^\/]*$/, ""); // remove filename
        var switch_ip = switch_url;
        var name = tag.find("div b").text();
        var name_idx = name.indexOf(": ");
        if (name_idx>=0) {
          switch_ip = name.substr(0, name_idx);
          name = name.substr(name_idx+2);
        }
        for (i in excluded_interfaces)
          if (name.search(excluded_interfaces[i])>=0)
            return;
        files.push([switch_url+fname+".log", name, switch_ip]);
      }
    });
    files_to_load += files.length;
    if (files_to_load<=0)
      $("#progress").text("No data to load");
    for (var fni=0; fni<files.length; fni++)
      load_mrtg_log(files[fni][0], files[fni][1], files[fni][2], switch_url);
  }).fail(function(jqXHR, textStatus, error) {
    $("#error").text(
      "Failed to load index file: " + switch_url + ": " + error);
    $("#error").show();
    $("#download").show();
  });
}

/*
  Storage functions
  ==================
*/

// Load storwize stats for one file.
function load_storwize(filename, tagsrc) {
  $.ajax({
    url: filename,
    dataType: "xml"
  }).done(function(data) {
    var nodeid = 'node'+(filename.split("_")[2].split("-")[1]);
    var colls = data.getElementsByTagName("diskStatsColl");
    if (tagsrc=="disk") tagsrc = "mdsk";
    for (var coll_id=0; coll_id<colls.length; coll_id++) {
      var coll = colls[coll_id];
      var timestamp = Date.parse(
        coll.attributes["timestamp"].value.replace(" ", "T")
      );
      var sizeunit = parseInt(
        coll.attributes["sizeUnits"].value.replace("B", "")
      );
      var dsks = coll.getElementsByTagName(tagsrc);
      for (var dsk_id=0; dsk_id<dsks.length; dsk_id++) {
        var dsk = dsks[dsk_id], value,
            name = dsk.attributes['id'].value;
        if (!name) name = dsk.attributes['idx'].value;
        if (!counters[name]) {
          counters[name] = {};
          for (var key in data_items)
            counters[name][data_items[key]] = { node1: [], node2: [] };
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
    files_to_load -= 1;
    $("#progress").text(files_to_load+" files to load");
    if (files_to_load<=0) {
      deltas = {};
      for (var name in counters) {
        if (!deltas[name]) {
          deltas[name] = {name: name};
          for (var key in data_items)
            deltas[name][data_items[key]] = [];
        }
        for (var rw in counters[name]) {
          deltas[name][rw] = joinarrays([
            arraydelta(counters[name][rw]['node1'], rw),
            arraydelta(counters[name][rw]['node2'], rw)
          ]);
        }
      }
      update_checkboxes();
      plot_graph();
    }
  });
}

// Load unisphere stats for one file.
function load_unisphere(filename, tagsrc) {
  $.ajax({
    url: filename
  }).done(function(data) {
    var rows = data.split("\n");
    var nodeid, name = "", lun="", rg="", timestamp, sizeunit=512;

    for (var row_id=0; row_id<rows.length; row_id++) {
      var row = rows[row_id];
      var args = row.split(" ");
      var rargs = args.slice();
      rargs.reverse();
      if (row.indexOf("Name   ")==0) {
        if (rargs[1]!="LUN") {
          name = rargs[0];
          if (tagsrc=="vdsk") {
            if (!counters[name]) {
              counters[name] = {};
              for (var key in data_items)
                counters[name][data_items[key]] = [];
            }
          }
        } else {
          name = "";
        }
      } else if (row.indexOf("RAIDGroup ID:")==0) {
        rg = rargs[0];
        if (tagsrc=="mdsk") {
          if (!counters[rg]) {
            counters[rg] = {};
            for (var key in data_items)
              counters[rg][data_items[key]] = [];
          }
        }
      } else if (row.indexOf("Statistics logging current time:")==0) {
        var t = rargs[0], d = rargs[1];
        timestamp = Date.parse(
          "20"+d[6]+d[7]+"-"+d[0]+d[1]+"-"+d[3]+d[4]+"T"+t
        )
      }
      if (name!="") {
        if (tagsrc=="vdsk") {
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
        } else if (tagsrc=="mdsk") {
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
    files_to_load -= 1;
    $("#progress").text(files_to_load+" files to load");
    if (files_to_load<=0) {
      deltas = {};
      for (var name in counters) {
        if (!deltas[name]) {
          deltas[name] = {name: name};
          for (var key in data_items)
            deltas[name][data_items[key]] = [];
        }
        for (var rw in counters[name]) {
          var arrs = [];
          for (nodeid in counters[name][rw])
            arrs.push(arraydelta(counters[name][rw][nodeid], rw));
          deltas[name][rw] = joinarrays(arrs);
        }
      }
      update_checkboxes();
      plot_graph();
    }
  });
}

// Load file index and start loading of files.
function load_storage_index() {
  // global variable
  data_items = ["rb", "wb", "ro", "wo", "rl", "wl", "rt", "wt"];
  $("#graph").empty();
  $("#graph").append(loader);
  $("#progress").text("");
  counters = {};
  $.ajax({
    url: "iostats/",
    cache: false
  }).done(function(data) {
    var files = [];
    var tagsrc = $("#graph_source option:selected").attr("value");
    var tags = $(data).find("a");
    var current_datetime = new Date();
    var interval = parseInt($("#interval").attr("value"));
    range_from = Number(current_datetime - interval*one_hour);
    range_to = Number(current_datetime); // convert to number
    for (var tagi=0; tagi<tags.length; tagi++) {
      var href = tags[tagi].getAttribute("href");
      if (href[href.length-1]=="/") continue;
      // Storwize
      if (href.indexOf("N"+tagsrc[0]+"_stats_")==0) {
        var hrefa = href.split("_");
        var d = hrefa[3], t = hrefa[4];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push("iostats/"+href);
      }
      // Unisphere
      if (href.indexOf("Uni_")==0) {
        var hrefa = href.split("_");
        var d = hrefa[hrefa.length-2], t = hrefa[hrefa.length-1];
        if (current_datetime-parsedatetime(d, t)<interval*one_hour)
          files.push("iostats/"+href);
      }
    }
    files_to_load = files.length;
    if (files_to_load<=0) {
      $("#progress").text("No data to load");
    }
    for (var fni=0; fni<files_to_load; fni++) {
      if (files[fni].indexOf("iostats/N")==0) {
        load_storwize(files[fni], tagsrc);
      } else if (files[fni].indexOf("iostats/U")==0) {
        load_unisphere(files[fni], tagsrc);
      }
    }
  });
}

/*
  Common functions
  =================
*/

function refresh_range() {
  if (storage_files.length>0) {
    refresh_graph();
  } else {
    var current_datetime = new Date();
    var interval = parseInt($("#interval").attr("value"));
    range_from = Number(current_datetime - interval*one_hour);
    range_to = Number(current_datetime); // convert to number
    plot_graph();
  }
}

function refresh_graph() {
  range_from = null;
  range_to = null;
  files_to_load = 0;
  for (var idx=0; idx<mrtg_files.length; idx++)
    load_mrtg_index(mrtg_files[idx]);
  for (var idx=0; idx<storage_files.length; idx++)
    load_storage_index(storage_files[idx]);
}

$(function() {
  loader = $("#loader");
  $("#interval").change(refresh_range);
  $("#graph_source").change(function() {
    // Remove checkboxes, because new source has different checkboxes.
    $("#choices").empty();
    refresh_graph();
  });
  $("#reload").click(refresh_graph);
  $("#zoomout").click(function() {
    var current_datetime = new Date();
    var interval = parseInt($("#interval").attr("value"));
    range_from = Number(current_datetime - interval*one_hour);
    range_to = Number(current_datetime); // convert to number
    plot_graph();
  });
  $("#all_none").click(setall);
  $("#more_info").click(function() {
    $("#info_table").animate({height: "toggle"}, 300);
  });
  add_callbacks();
  // parse query string
  var query = window.location.search.substring(1);
  if (query) {
    var args = query.split("&");
    for (var i in args) {
      var arg = args[i].split("=");
      if (arg[0]=="t") {
        $("#graph_type").val(arg[1]);
      } else if (arg[0]=="u") {
        $("#units").val(arg[1]);
      } else if (arg[0]=="i") {
        var arg1 = arg[1], arg1l = arg1[arg1.length-1];
        if (arg1l in range_multiplier) {
          arg1 = Math.floor(parseFloat(arg1)*range_multiplier[arg1l]);
        } else {
          arg1 = Math.floor(parseFloat(arg1));
        }
        var itag = $("#interval option[value='"+arg1+"']");
        if (itag.length==0)
          $("#interval").append(
            '<option value="'+arg1+'">'+arg1+' hours</option>'
          );
        $("#interval").val(arg1);
      } else if (arg[0]=="s") {
        storage_files.push(arg[i]);
      } else {
        var sarg = arg[1].split(",");
        var prefix = sarg[0].replace(/[^\/]*\/$/, '');
        mrtg_files.push(sarg[0]);
        for (var i=1; i<sarg.length; i++) mrtg_files.push(prefix+sarg[i]);
      }
    }
  } else {
    if ($("#graph_type").length>0) {
      storage_files.push("iostats/");
    } else {
      mrtg_files.push("mrtg/");
    }
  }
  refresh_graph();
});
