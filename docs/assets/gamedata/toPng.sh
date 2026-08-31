#!/bin/bash
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


# Loop through all files in the current directory
for file in *; do
    # Check if it's a regular file (skips directories and the script itself)
    if [ -f "$file" ] && [ "$file" != "copy_to_png.sh" ]; then
        # Copy the file and append .png to the destination name
        cp "$file" "$file.png"
        echo "Created: $file.png"
    fi
done

echo "Done! All files have been copied with a .png extension."
