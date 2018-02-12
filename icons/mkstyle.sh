#!/bin/bash

optimize() {
  tr -d '\n' < "$1" | sed -e 's/ \+/ /g' -e 's/> \+</></g' \
    -e 's/#/%23/g' -e 's/</%3C/g' -e 's/>/%3E/g' -e "s/\"/'/g"
}

cd `dirname $0`
for svg in *.svg; do
  name="${svg%.svg}"
  if [ "$name" = "check" ]; then
    echo "div.trafgrapher input[type='checkbox']:checked {"
  elif [ "$name" = "select_down" ]; then
    echo "div.trafgrapher div.selection select {"
  else
    echo "div.trafgrapher button.b_$name {"
  fi
  echo "  background-image: url(\"data:image/svg+xml,`optimize $svg`\");"
  echo "}"
done
