#!/bin/bash

DIR=${1:-iostats}

# cleanup old files
tmpwatch --ctime 168 $DIR

pushd $DIR > /dev/null || exit 1

(
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
) > index.html

popd > /dev/null
