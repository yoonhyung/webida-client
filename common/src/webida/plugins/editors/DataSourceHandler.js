/*
* Copyright (c) 2012-2015 S-Core Co., Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

/**
 * Constructor
 * DataSourceHandler
 *
 * @see
 * @since: 2015.07.15
 * @author: hw.shim
 */

// @formatter:off
define([
    'dojo/topic',
    'external/eventEmitter/EventEmitter',
    'webida-lib/plugins/workbench/plugin', //TODO : refactor
    'webida-lib/util/genetic',
    'webida-lib/util/logger/logger-client'
], function(
    topic,
    EventEmitter,
    workbench,
    genetic, 
    Logger
) {
    'use strict';
// @formatter:on

    /**
     * @typedef {Object} DataSource
     */

    var logger = new Logger();
    //logger.setConfig('level', Logger.LEVELS.log);
    //logger.off();

    var singleton = null;

    function DataSourceHandler() {
        logger.info('new DataSourceHandler()');

        /** @type {Object} */
        this.subscribed = [];
        /** @type {Array.<Array>} */
        this.deletedNodesSet = [];
        this._subscribe();
    }

    /**
     * @return {DataSourceHandler}
     */
    DataSourceHandler.getInstance = function() {
        if (singleton === null) {
            singleton = new this();
        }
        return singleton;
    }

    genetic.inherits(DataSourceHandler, EventEmitter, {

        /**
         * subscribe to topic
         * @private
         */
        _subscribe: function() {
            //on deleted
            this.subscribed.push(topic.subscribe('workspace.nodes.deleting', this._onNodesDeleted.bind(this)));
            this.subscribed.push(topic.subscribe('fs.cache.node.deleted', this._checkCase.bind(this)));

            //on content changed
            this.subscribed.push(topic.subscribe('data-source/content-change', this._onContentChange.bind(this)));
        },

        /**
         * unsubscribe topics
         * @private
         */
        _unsubscribe: function() {
            this.subscribed.forEach(function(subscribed) {
                subscribed.remove();
            });
        },

        /**
         * @private
         */
        _isMultiDelete: function(path) {
            var result = false;
            this.deletedNodesSet.forEach(function(deletedNodes) {
                deletedNodes.forEach(function(node) {
                    if (node === path) {
                        result = true;
                    }
                });
            });
            return result;
        },

        /**
         * @private
         */
        _checkCase: function(fsUrl, dir, name, type, movedPath) {
            logger.info('_checkCase(' + this._getArgs(arguments) + ')');

            var path = dir + name;

            if (type === 'file') {
                if (movedPath) {
                    this._onNodeMoved(path, movedPath);
                } else {
                    this._onNodeDeleted(path);
                }
            } else if (type === 'dir') {
                path += '/';
                if (movedPath) {
                    movedPath += '/';
                    this._onDirMoved(path, movedPath);
                } else {
                    this._onDirDeleted(path);
                }
            }
        },

        // ************* On Moved ************* //

        /**
         * @private
         */
        _onNodeMoved: function(sourcePath, targetPath) {
            logger.info('_onNodeMoved(' + sourcePath + ', ' + targetPath + ')');
            var dsRegistry = workbench.getDataSourceRegistry();
            var dataSource = dsRegistry.getDataSourceById(sourcePath);
            if (dataSource) {
                dataSource.setId(targetPath);
            }
        },

        /**
         * @private
         */
        _onDirMoved: function(sourceDir, targetDir) {
            logger.info('_onDirMoved(' + sourceDir + ', ' + targetDir + ')');
            var dataSource, persistence, dsId;
            var registry = this._getPartRegistry();
            var editorParts = registry.getEditorParts();
            editorParts.forEach(function(editorPart) {
                dataSource = editorPart.getDataSource();
                persistence = dataSource.getPersistence();
                dsId = dataSource.getId();
                if (dsId.indexOf(sourceDir) >= 0) {
                    dataSource.setId(targetDir + persistence.getName());
                }
            });
        },

        // ************* On Deleted ************* //

        /**
         * @private
         */
        _onDirDeleted: function(dirPath) {
            logger.info('_onDirDeleted(' + dirPath + ')');
            var dataSource;
            var shouldBeClosedParts = [];
            var registry = this._getPartRegistry();
            var editorParts = registry.getEditorParts();
            editorParts.forEach(function(editorPart) {
                dataSource = editorPart.getDataSource();
                if (dataSource) {
                    if (dataSource.getId().indexOf(dirPath) >= 0) {
                        dataSource.setDeleted(true);
                        dataSource.getPersistence().setContents(null);
                        editorPart.getContainer().updateDirtyState();
                        shouldBeClosedParts.push(editorPart);
                    }
                }
            });
            shouldBeClosedParts.forEach(function(part) {
                _askClose(part.getDataSource());
            });
        },

        /**
         * @private
         * TODO : Support Close All (or Remain All)
         * But, This feature is required indeed? :(
         */
        _onNodesDeleted: function(nodes) {
            logger.info('_onNodesDeleted(' + nodes + ')');
            this.deletedNodesSet.push(nodes);
        },

        /**
         * @private
         */
        _onNodeDeleted: function(dataSourceId) {
            logger.info('_onNodeDeleted(' + dataSourceId + ')');
            var registry = this._getPartRegistry();
            var dsRegistry = workbench.getDataSourceRegistry();
            var dataSource = dsRegistry.getDataSourceById(dataSourceId);
            var parts = registry.getPartsByDataSource(dataSource);
            if (dataSource) {
                dataSource.setDeleted(true);
                dataSource.getPersistence().setContents(null);
            }
            if (parts.length > 0) {
            	parts.forEach(function(part){
            		part.getContainer().updateDirtyState();
            	});
                _askClose(dataSource);
            }
        },

        // ************* On Content Changed ************* //

        _onContentChange: function(dataSourceId) {
            var dsRegistry = workbench.getDataSourceRegistry();
            var dataSource = dsRegistry.getDataSourceById(dataSourceId);
            _askReload(dataSource);
        },

        /**
         * @private
         */
        _getPartRegistry: function() {
            var page = workbench.getCurrentPage();
            return page.getPartRegistry();
        },

        /**
         * @private
         */
        _getArgs: function(args) {
            var res = [];
            for (var i = 0; i < args.length; i++) {
                res.push = args[i];
            }
            return res.join(', ');
        }
    });

    function _askClose(dataSource) {
        var dataSourceId = dataSource.getId();
        var persistence = dataSource.getPersistence();
        require(['popup-dialog'], function(PopupDialog) {
            // @formatter:off
            PopupDialog.yesno({
                title: "Close '" + persistence.getName() + "'?",
                message: "'" + persistence.getPath() + "' has been deleted. "
                    + 'Close the editor for the resource?'
            }).then(function() {
                topic.publish('editor/close/data-source-id', dataSourceId, {
                    force: true
                });
            }, function() {
            });
            // @formatter:on
        });
    }

    function _askReload(dataSource) {
        var dataSourceId = dataSource.getId();
        var persistence = dataSource.getPersistence();
        require(['popup-dialog'], function(PopupDialog) {
            // @formatter:off
            PopupDialog.yesno({
                title: "Reload '" + persistence.getName() + "'?",
                message: "'" + persistence.getPath() + "' has been changed. "
                    + 'Reload the editor(s) for the resource?',
                type: 'warning'
            }).then(function() {
                var page = workbench.getCurrentPage();
                var registry = page.getPartRegistry();
                var parts = registry.getPartsByDataSource(dataSource);
                parts.forEach(function(part) {
                    part.resetModel();
                });
            }, function() {
            });
            // @formatter:on
        });
    }

    return DataSourceHandler;
});
