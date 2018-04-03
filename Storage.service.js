/**
 * @author - Jake Liscom
 * @project - OpenNote
 */

/**
 * Function that add storage Service options to this scope. Can be used with .apply or .call to export functionality to a given scope
 * @param   localStorage            - DI for localStorage
 * @param   PouchDB                 - DI for PouchDB
 * @param   syncConfig              - Map with options and callback properties
 * @param   dbPath                  - How DB is stored. In the CLI its the path. In the browser it is the local storage key
 */
module.exports = function(localStorage, PouchDB, syncConfig, dbPath) {
    dbPath = dbPath || "openNote";
    var localDatabase = null;
    var remoteDatabase = null;
    var self = this;

    /**
     * helper function to create indexes
     * @param name - the name of the index
     * @param mapFunction - the map function
     */
    var createDesignDoc = function(name, mapFunction) {
        var ddoc = {
            _id: "_design/" + name,
            views: {}
        };
        ddoc.views[name] = {
            map: mapFunction.toString()
        };
        return ddoc;
    };

    /**
     * Initialize the PouchDB database and create indexes
     */
    this.init = function() {
        //Create or find database
        localDatabase = new PouchDB(dbPath);

        //Force the latest parentFolderID design doc by deleting conflicts if they exists
        localDatabase.get("_design/parentFolderID",{conflicts: true}).then(function(doc){
            if(!doc._conflicts)// No conflicts do nothing
                return;
            doc._conflicts.forEach(function(rev){
                localDatabase.remove("_design/parentFolderID",rev);
            });
        }).catch(function(err) {
            if (err.status != 404)//Ignore if the document doesnt exist
                throw err;
        });

        //Indexes
        localDatabase.put(createDesignDoc("parentFolderID", function(doc) {
            emit(doc.parentFolderID);
        })).catch(function(err) {
            if (err.status != 409)
                throw err;
            // ignore if doc already exists
        });

        //Re-init sync
        var url = localStorage.getItem("remoteURL");
        if (url) {
            remoteDatabase = new PouchDB(url);
            this.setupSync();
        }
    };

    /**
     * @param url - The remote URL to use in replication
     */
    this.setRemoteURL = function(url) {
        localStorage.setItem("remoteURL", url);
        remoteDatabase = new PouchDB(url);
    };

    /**
     * @return - The remote URL to use in replication
     */
    this.getRemoteURL = function() {
        return localStorage.getItem("remoteURL");
    };


    /**
     * Get method
     * @param  {[type]} id  - id of the doc to get
     * @return {Promise}    - when resolves returns the doc
     */
    this.get = function(id){
        return localDatabase.get(id);
    };

    /**
     * Post method
     * @param  {[type]} doc  - the doc to put
     * @return {Promise}     - when resolves returns the result
     */
    this.post = function(doc){
        return localDatabase.post(doc);
    };


    /**
     * Put method
     * @param  {[type]} doc  - the doc to put
     * @return {Promise}     - when resolves returns the result
     */
    this.put = function(doc){
        return localDatabase.put(doc);
    };

    /**
     * Delete method
     * @param  {[type]} doc  - the doc to put
     * @return {Promise}     - when resolves returns the result
     */
    this.delete = function(doc){
        return localDatabase.remove(doc);
    };

    /**
     * Returns all docs in the database
     * @return {Promise}    - when resolves returns a list of all docs
     */
    this.allDocs = function(){
        return localDatabase.allDocs({include_docs:true});
    };

    /**
     * Get the remote database
     */
    this.remoteDatabase = function() {
        return remoteDatabase;
    };

    /**
     * Setup live sync
     */
    this.setupSync = function() {
        syncConfig.callback(localDatabase.sync(remoteDatabase, syncConfig.options)); //This allows consumer of this function to set all desired event handlers
    };

    /**
     * Load a folders contents
     * @param folderID - the folder id to load the content folder
     * @return {Promise}     - when resolves returns the results
     */
    this.loadFolderContents = function(folderID) {
        return  localDatabase.query("parentFolderID", {
            key: folderID,
            include_docs: true
        });
    };

    /**
     * Delete the database
     */
    this.destroyDatabase = function(callback) {
        localDatabase.destroy().then(function() {
            localStorage.removeItem("remoteURL");
            self.init();
            callback();
        });
    };

    /**
     * Dump database to a file
     * @param callback - callback where data is returned to
     */
    this.exportToFile = function(callback) {
        localDatabase.allDocs({
            include_docs: true
        }).then(function(result) {
            var file = new Blob([JSON.stringify({
                data: result.rows
            })], {
                type: "application/json"
            }); // the blob
            callback(URL.createObjectURL(file));
        });
    };

    /**
     * Import database from a file
     */
    this.importFile = function(backup) {
        backup.data.forEach(function(document) {
            localDatabase.put(document.doc).catch(function(error) {
                if (error.status == 409) {
                    var errorMSG = document.doc._id + " was in conflict and was not imported";
                    alertify.error(errorMSG); //FIXME use a callback
                    console.error(errorMSG);
                } else throw error;
            });
        });
    };

    /**
     * Delete a folder tree
     * @param  folder - the folder doc to delete
     * @param callback - callback when the given folder has been removed
     */
    this.deleteFolder = function(folder, callback) { //TODO test
        if (!folder._id) //Required
            return;
        self.loadFolderContents(folder._id).then(function(results) {
            results.rows.filter(self.noteFilter).forEach(function(note) {
                localDatabase.remove(note.doc);
            });

            results.rows.filter(self.folderFilter).forEach(function(subFolder) {
                self.deleteFolder(subFolder.doc);
            });
            localDatabase.remove(folder).then(callback);
        });
    };


    /**
     * Find an clean the orphans
     * That is delete docs whose parent id is not null and does not exist in the database
     */
    this.cleanOrphans = function() {
        var map = {};
        var length = 0;
        var processed = 0;

        /**
         * Check to see if we have processed all the records
         * @return {[type]} [description]
         */
        var doneCheck = function() {
            processed++;
            if (processed >= length)
                orphanRemover();
        };

        /**
         * Find orphans
         * @param result - the result object as returned by allDocs
         */
        var orphanHunter = function(result) {
            if (!result.doc.parentFolderID) //nulls are root and cannot be orphans
                return doneCheck();

            localDatabase.get(result.doc.parentFolderID).then(doneCheck).catch(function(err) {
                if (err.status == 404)
                    map[result.id] = result;
                else
                    throw err;

                doneCheck();
            });
        };

        /**
         * Remove the orphans
         */
        var orphanRemover = function() {
            for (var orphan in map) {
                if (typeFilter(map[orphan], "folder"))
                    self.deleteFolder(map[orphan]);
                else
                    localDatabase.remove(map[orphan].doc);
            }
        };

        localDatabase.allDocs({
            include_docs: true
        }).then(function(result) {
            length = result.rows.length;
            result.rows.forEach(orphanHunter);
        });
    };

    /**
     * Filter out everything but a given type
     * @param object - the object to filter
     * @param type - the type to filter in
     */
    var typeFilter = function(object, type) {
        if(!object || !object.doc) // If for some reason we are filtering an empty list
            return false;
        return object.doc.type == type;
    };

    /**
     * Filter out everything but type folder
     */
    this.folderFilter = function(object) {
        return typeFilter(object, "folder");
    };

    /**
     * Filter out everything but type note
     */
    this.noteFilter = function(object) {
        return typeFilter(object, "note");
    };

    //First time create database
    //this.init(); //This, ha ha, is now called from the consumer of this abstraction
};
