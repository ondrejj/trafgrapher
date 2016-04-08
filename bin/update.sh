#!/bin/bash

DIR=${1:-iostats}

mk_index_html() {
  echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
  echo "<!DOCTYPE html>"
  echo "<html>"
  echo "<head></head>"
  echo "<body>"
  echo "<div>"
  for i in *; do
    if [ ! "$i" = "index.html" ]; then
      echo "<a href=\"$i\">$i</a><br/>"
    fi
  done
  echo "</div>"
  echo "</body>"
  echo "</html>"
}

mk_index_txt() {
  ls -1
}

# cleanup old files
tmpwatch --ctime 168 $DIR

pushd $DIR > /dev/null || exit 1

#mk_index_html > index.html
mk_index_txt > index.html

popd > /dev/null
