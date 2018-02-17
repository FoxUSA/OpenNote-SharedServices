/**
 * @author - Jake Liscom
 * @project - OpenNote
 */


var tagRegex = /(?:\ |^|\n|>)(#[^\ <\n]+)/ig;


/**
 * [exports description]
 * @param  {[type]} storageService [description]
 * @param  {[type]} eventEmitter   - bus to fire events on. Optional
 * @return {[type]}                - Service instance
 */
module.exports = function(storageService, eventEmitter) {
    eventEmitter = eventEmitter || function(){}; //Default
    var addTagsToMap = function(tags, id) {
        var saveCallback = function(response) {
            if (!response.ok)
                throw response;
            eventEmitter("tagsUpdated");
        };

        /**
         * Add tags to the map
         * @param tags - array of tags present
         * @param id - ID of the note
         * @emmit - emiits tagsUpdated on success
         */
        var addTags = function(map) {
            tags.forEach(function(tag) {
                tag = tag.toLowerCase();
                if (!tag.indexOf("#39;") || !tag.indexOf("#34;")) //Remove html and special characters
                    return;

                if (!map.tags[tag])
                    return (map.tags[tag] = [id]);
                return map.tags[tag].push(id);
            });

            map._id = "tagMap";
            storageService.put(map).then(saveCallback);
        };

        methods.getMap().then(addTags, function(err) {
            if (err.status == 404)
                return addTags({
                    tags: {}
                }); //Nothing found nothing to delete
            throw err;
        });
    };

    /**
     * Remove all tags for an id
     * @param id - the id to remove tags for
     * @return {Promise} -
     */
    var deleteTagsFromMap = function(id) {
        return new Promise(function(resolve, reject) {
            methods.getMap().then(function(map) {
                //Remove all tags from array
                for (var tag in map.tags) {
                    var index = map.tags[tag].indexOf(id);
                    if (index == -1)
                        continue;
                    map.tags[tag].splice(index, 1);
                    if (!map.tags[tag].length)
                        delete map.tags[tag];
                }

                //Save
                storageService.put(map).then(function(response) {
                    if (!response.ok)
                        throw response;
                    eventEmitter("tagsUpdated");
                    return resolve();
                });
            }, function(err) {
                if (err.status == 404)
                    return resolve(); //Nothing found nothing to delete
                return reject(err);
            });
        });
    };


    //Exposed methods
    var methods = {
        /**
         * SaveNote
         * @param  {[type]} note Modified note to detect tags and delete
         */
        saveNote: function(note) {
            deleteTagsFromMap(note._id).then(function() {
                var matches;
                var output = [];
                while ((matches = tagRegex.exec(note.note)))
                    output.push(matches[1]);

                if (!output.length)
                    return;
                addTagsToMap(output, note._id);
            });
        },

        /**
         * Delete notes
         * @param  {[type]} note note object to delete
         */
        deleteNote: function(note){
            deleteTagsFromMap(note._id);
        },

        /**
         * Delete a folder tree
         * @param  folder - the folder doc to delete
         */
        deleteFolder: function(folder) {//TODO Needs to a promise
            if (!folder._id) //Required
                return;

            var promises = [];

            // Wrapper for Promise.all that will allow multiple batches of promises to be picked up by Promise.all. By defauly only the entires that exist when Promise.all is called. Enttries to the list ofter will be missed.
            var recursiveAll = function(array) {
                return Promise.all(array).then(function(result) {
                    if (result.length == array.length) // If no new promises were added, return the result
                        return eventEmitter("tagsUpdated");

                    return recursiveAll(array); // If new promises were added, re-evaluate the array.
                });
            };


            // Recursive worker function
            var internalFunction = function(folder){
                promises.push(new Promise(function(resolve){
                    storageService.loadFolderContents(folder._id).then(function(results) {
                        results.rows.filter(storageService.noteFilter).forEach(function(note) {
                            methods.deleteNote(note.doc);
                        });

                        results.rows.filter(storageService.folderFilter).forEach(function(subFolder) {
                            internalFunction(subFolder.doc);
                        });

                        return resolve();
                    });
                }));
            };

            internalFunction(folder); //Start the engine
            return recursiveAll(promises);
        },


        /**
         * Get the map
         * @return - a promise that when resolves return the tag map
         */
        getMap: function() {
            return storageService.get("tagMap");
        }
    };

    return methods;
};
