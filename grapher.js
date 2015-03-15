/*
  trafgrapher
  version 0.6
  (c) 2015 Jan ONDREJ (SAL) <ondrejj(at)salstar.sk>
  Licensed under the MIT license.
*/

// Global variables
var deltas = {},
    files_to_load = -1,
    plot = null,
    range_from, range_to,
    one_hour = 3600000,
    units = "iB/s";
var excluded_interfaces = [
  // CISCO
  /^unrouted-VLAN-/,
  // DELL
  /^-Link-Aggregate-/,
  /^-CPU-Interface-for-Unit:-/,
  /^Unit:-/,
  /^Backbone$/,
];

// Set all input choices to defined value.
function setall() {
  var value = $("#checkbox_all").prop("checked");
  $("#choices input").attr("checked", value);
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
  var graph_type = $("#graph_type option:selected").attr("value");
  var unit = $("#units option:selected").attr("value");
  var placeholder = $("#graph");
  $("#checkbox_all").attr("checked",
    $("#choices input").length == $("#choices input:checked").length
  );
  var checked_choices = $("#choices").find("input:checked");
  var colors = gen_colors(checked_choices.length);
  checked_choices.each(function (n) {
    var name = $(this).attr("name");
    for (var grapht=0; grapht<graph_type.length; grapht++) {
      flots.push({
        label: graph_type[grapht]+"_"+name,
        color: colors[n],
        data: filter_interval(
                deltas[name][graph_type[grapht]], unit,
                graph_type[grapht]==graph_type[grapht].toUpperCase()
              )
      })
    }
  });
  units = 'i'+unit+"/s";
  plot = $.plot(placeholder, flots, {
    xaxis: { mode: "time", timezone: "browser" },
    yaxis: {
      // min: 0,
      // minTickSize: 1024,
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
    $("li#li"+series[i].label.substr(2)+" div").css(
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
      var label = item.series.label.substr(2);
      $("ul#choices li").css("border-color", "transparent");
      $("ul#choices li#li"+label).css("border-color", "black");
      $("#throughput").attr("value", kilomega(item.datapoint[1], 2));
      // compute bytes
      var graph_type = item.series.label[0];
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
        var table = $(noimgdata).find("table:first");
        $("#info_table").html(table[0]);
      });
    }
  });
  placeholder.bind("plotclick", function(event, pos, item) {
    if (item) {
      var label = item.series.label.substr(2);
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
      "'><div class='box'>&nbsp;</div><input type='checkbox' name='" + key +
      "' checked='checked' id='cb" + key + "'></input>" +
      "<label for='cb" + key + "'>"
      + deltas[key]['name'] + "</label></li>");
  }
  $("#choices").find("input").click(plot_graph);
  $("#checkbox_all").change(setall);
  $("#graph_type").change(plot_graph);
  $("#units").change(plot_graph);
}

// Load MRTG stats for one file.
function load_mrtg_log(filename, name, switch_ip, switch_url) {
  $.ajax({
    url: filename,
    dataType: "text",
    cache: false
  }).done(function(data) {
    var basename = filename.substr(filename.lastIndexOf("/")+1);
    var port_id = basename.substr(basename.indexOf("_")+1);
    var ethid =
          +switch_ip.replace(/[^a-z0-9]/gi, "_")
          +port_id.split(".")[0];
    var lines = data.split("\n");
    name = $("<div/>").text(name).html(); // escape html in name
    deltas[ethid] = {
      'name': name, 'url': switch_url, 'ip': switch_ip,
      'html': filename.replace(/\.log$/, ".html"),
      'o': [], 'i': [], 'j': [], //'t': [], 'd': [],
      'O': [], 'I': [], 'J': [], //'T': [], 'D': []
    };
    for (var line=1; line<lines.length; line++) {
      var cols = lines[line].split(" ");
      var t = parseInt(cols[0])*1000,
          ib = parseInt(cols[1]), ob = parseInt(cols[2]),
          im = parseInt(cols[3]), om = parseInt(cols[4]);
      deltas[ethid]['i'].push([t, ib]);
      deltas[ethid]['j'].push([t, -ib]);
      deltas[ethid]['o'].push([t, ob]);
      //deltas[ethid]['t'].push([t, ib+ob]);
      //deltas[ethid]['d'].push([t, ob-ib]);
      deltas[ethid]['I'].push([t, im]);
      deltas[ethid]['J'].push([t, -im]);
      deltas[ethid]['O'].push([t, om]);
      //deltas[ethid]['T'].push([t, im+om]);
      //deltas[ethid]['D'].push([t, om-im]);
    }
    files_to_load -= 1;
    $("#progress").text(files_to_load+" files to load");
    if (files_to_load<=0) {
      update_checkboxes();
      plot_graph();
      add_callbacks();
    }
  }).fail(function(jqXHR, textStatus, error) {
    $("#error").text(
      "Failed to load log file: " + filename + ": " + error);
    $("#error").show();
  });
}

// Load file index and start loading of files.
function load_index(switch_url) {
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
    if (files_to_load<=0) {
      $("#progress").text("No data to load");
    }
    for (var fni=0; fni<files.length; fni++) {
      load_mrtg_log(files[fni][0], files[fni][1], files[fni][2], switch_url);
    }
  }).fail(function(jqXHR, textStatus, error) {
    $("#error").text(
      "Failed to load index file: " + switch_url + ": " + error);
    $("#error").show();
    $("#download").show();
  });
}

function refresh_range() {
  var current_datetime = new Date();
  var interval = parseInt($("#interval").attr("value"));
  range_from = Number(current_datetime - interval*one_hour);
  range_to = Number(current_datetime); // convert to number
  plot_graph();
}

function refresh_graph() {
  range_from = null;
  range_to = null;
  files_to_load = 0;
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
        $("#interval").val(arg[1]);
      } else {
        var sarg = arg[1].split(",");
        var prefix = sarg[0].replace(/[^\/]*\/$/, '');
        load_index(sarg[0]);
        for (var i=1; i<sarg.length; i++) load_index(prefix+sarg[i]);
      }
    }
  } else {
    load_index("mrtg/");
  }
}

$(function() {
  loader = $("#loader");
  $("#interval").change(refresh_range);
  $("#reload").click(refresh_graph);
  $("#zoomout").click(function() {
    var current_datetime = new Date();
    var interval = parseInt($("#interval").attr("value"));
    range_from = Number(current_datetime - interval*one_hour);
    range_to = Number(current_datetime); // convert to number
    plot_graph();
  });
  $("#more_info").click(function() {
    $("#info_table").animate({height: "toggle"}, 300);
  });
  refresh_graph();
});
