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
            storageService.database().put(map).then(saveCallback);
        };

        this.getMap().then(addTags, function(err) {
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
     * @param callback - calls on sucessful return
     */
    var deleteTagsFromMap = function(id, callback) {
        this.getMap().then(function(map) {
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
            storageService.database().put(map).then(function(response) {
                if (!response.ok)
                    throw response;
                eventEmitter("tagsUpdated");
                return callback();
            });
        }, function(err) {
            if (err.status == 404)
                return callback(); //Nothing found nothing to delete
            throw err;
        });
    };


    //Exposed methods
    return {
        /**
         * SaveNote
         * @param  {[type]} note Modified note to detect tags and delete
         */
        saveNote: function(note) {
            deleteTagsFromMap(note._id, function() {
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
            deleteTagsFromMap(note._id,function(){});
        },



        /**
         * Get the map
         * @return - a promise that when resolves return the tag map
         */
        getMap: function() {
            return storageService.database().get("tagMap");
        }
    };
};
