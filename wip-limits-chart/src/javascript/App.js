Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {

        var release = null;
        var iteration = "Iteration 1"; // this.getTimeboxScope();

        var that = this;
        var tbs = that.getTimeboxScope();
        if (!_.isNull(tbs)) {
            release = tbs.type === "release" ? tbs.name : null;
            iteration = tbs.type === "iteration" ? tbs.name : null;
        }
        that.run(release,iteration);

    },

    run : function(releaseName,iterationName) {

        var that = this;

        that.workItemFilter = that.createFilter(releaseName,iterationName);
        console.log(that.workItemFilter.toString());

        var fns = [
            that.readStates.bind(that),
            that.readProjects.bind(that),
            that.getReportProjects.bind(that),
            that.readWipValues.bind(that),
            that.readStories.bind(that),
            that.prepareChartData.bind(that),
            that.createChart.bind(that)
        ];

        async.waterfall( fns , function(err,result) {
            console.log("result",result);
            // console.log("parents",_.map(result,function(r){return r.get("Project")}));
        });

    },

    getTimeboxScope : function() {
        var timeboxScope = this.getContext().getTimeboxScope();
        if (timeboxScope) {
            return { type : timeboxScope.getType(), name : timeboxScope.getRecord().get("Name") };
        }
        return null;
    },

    onTimeboxScopeChange: function(newTimeboxScope) {
        this.callParent(arguments);
        if ((newTimeboxScope) && (newTimeboxScope.getType() === 'iteration')) {
            this.run(null,newTimeboxScope.getRecord().get("Name"));
        } else {
            if ((newTimeboxScope) && (newTimeboxScope.getType() === 'release')) {
                this.run(newTimeboxScope.getRecord().get("Name"),null);
            }
        }
    },

    // read the schedule states so we can include if necessary
    readStates : function(callback) {

        var that = this;

        Rally.data.ModelFactory.getModel({
            type: 'UserStory',
            success: function(model) {
                model.getField('ScheduleState').getAllowedValueStore().load({
                    callback: function(records, operation, success) {
                        that.scheduleStates = _.map(records,function(r){ return r.get("StringValue");});
                        callback(null);
                    }
                });
            }
        });

    },

    readProjects : function(callback) {

        var that = this;
        var config = { model : "Project", fetch : true, filters : [] };
        that._wsapiQuery(config,callback);

    }, 

    // child projects are what we graph
    getReportProjects : function(projects,callback) {

        var that = this;

        that.projects = projects;

        // filter to projects which are child of the current context project
        that.reportProjects = _.filter(projects, function(project) {
            return that._isChildOf( project, that.getContext().getProject() );
        });

        // if no children add self
        if (that.reportProjects.length ===0) {
            that.reportProjects.push(_.find(that.projects,function(project) {
                return project.get("ObjectID") === that.getContext().getProject().ObjectID;
            }));
        }

        callback(null,that.reportProjects);
    },


    // project-wip:IA-Program > IM FT Client outcomes > CAP DELIVERY 2 Scrum Team:DefinedWIP
    // "project-wip:IA-Program > Big Data Analytics & Shared Services > BDASS:CompletedWIP"
    readWipValues : function(reportProjects,callback) {

    	var that = this;

		var projectKeys = _.map( reportProjects, function(p) { return p.get("Name"); });

		var states = ["In-Progress","Completed"];

		var keys = _.flatten(_.map(projectKeys,function(pKey) {
			return _.map(states,function(state) {
				return "project-wip:" + pKey + ":" + state + "WIP";
			});
		}));
		console.log("keys",keys);

		var configs = _.map(keys,function(key) {
			return {
				model : "Preference",
				filters : [{property:"Name",operator:"=",value:key}],
				fetch : true
			};
		});

		async.map(configs, that._wsapiQuery, function(error,results){
			console.log("prefernece results",_.flatten(results));
			that.wipLimits = _.flatten(results);
			// callback(null,_.flatten(results));
			callback(null,reportProjects,that.wipLimits);
		});

    },

    readStories : function(reportProjects, wipLimits, callback) {

    	var that = this;

    	var configs = _.map(reportProjects,function(project) {
    		return {
    			model : "HierarchicalRequirement",
    			filters : [that.workItemFilter],
    			fetch : ["ObjectID","ScheduleState","PlanEstimate","Project"],
    			context : {
    				project: project.get("_ref"),
        			projectScopeUp: false,
        			projectScopeDown: true
    			}
    		}
    	});

    	// read stories for each reporting project
    	async.map(configs,that._wsapiQuery,function(error,results) {
    		console.log("stories",results);
    		callback(null,reportProjects,wipLimits,results)
    	});

    },

    prepareChartData : function(reportProjects,wipLimits,stories,callback) {

        var that = this;

        var categories = _.map(reportProjects,function(p) { return p.get("Name"); });

        var states = ["In-Progress","Completed"];

        var pointsValue = function(value) {
            return !_.isUndefined(value) && !_.isNull(value) ? value : 0;
        };

        // totals points for a set of work items based on if they are in a set of states
        var summarize = function( workItems, states ) {
            var stateTotal = _.reduce(  workItems, function(memo,workItem) {
                    return memo + ( _.indexOf(states,workItem.get("ScheduleState")) > -1 ? 
                        	1 : 0);
                },0);
            return stateTotal;
        };

        var wipForProjectAndState = function( project, state ) {
            var wip = _.find( wipLimits, function( limit ) {
                return limit.get("Name").indexOf(project.get("Name"))!==-1 &&
                    limit.get("Name").indexOf(state)!==-1;
            })
            if (!_.isUndefined(wip) && !_.isNull(wip)) {
                var val = wip.get("Value").replace(/"/g,"");
                return parseInt(val);
            } else {
                return 0;
            };
        }

        var seriesData = _.map( states, function( state ) {

            var counts = _.map( categories, function( project, index ) {
                return summarize( stories[index], [state]);
            });
            var wips = _.map( categories, function( project, index) {
                return wipForProjectAndState( reportProjects[index], state);
            });

            console.log("counts",counts,"wips",wips);

            return {
                name : state,
                data : _.map( categories, function( project, index) {
                    return counts[index] - wips[index]
                })
            };
        });

        console.log("seriesData",seriesData);

        callback(null,categories,seriesData);

    },

    createChart : function(categories,seriesData,callback) {

        var that = this;

        if (!_.isUndefined(that.chart)) {
            that.remove(that.chart);
        }

        that.chart = Ext.create('Rally.technicalservices.wipChart', {
            itemId: 'rally-chart',
            chartData: { series : seriesData, categories : categories },
            title: 'WIP Limits by Projecgt'
        });

        that.add(that.chart);

        var chart = this.down("#rally-chart");
        var p = Ext.get(chart.id);
        elems = p.query("div.x-mask");
        _.each(elems, function(e) { e.remove(); });
        var elems = p.query("div.x-mask-msg");
        _.each(elems, function(e) { e.remove(); });
    },

    // create a filter based on a combination of release and/or iteration
    createFilter : function( releaseName, iterationName ) { 
        var filter = null;

        if (!_.isNull(releaseName)) {
            filter = Ext.create('Rally.data.wsapi.Filter', {
                property: 'Release.Name',
                operator: '=',
                value: releaseName
            });
        }

        if (!_.isNull(iterationName)) {
            var ifilter = Ext.create('Rally.data.wsapi.Filter', {
                property: 'Iteration.Name',
                operator: '=',
                value: iterationName
            });

            filter = _.isNull(filter) ? ifilter : filter.and(ifilter);              
        }
        return filter;
    },

    _isChildOf : function( child, parent ) {
        var childParentRef = !_.isNull(child.get("Parent")) ? child.get("Parent")._ref : "null";
        return parent._ref.indexOf( childParentRef ) > -1;
    },

    // generic function to perform a web services query    
    _wsapiQuery : function( config , callback ) {

    	var storeConfig = {
            autoLoad : true,
            limit : "Infinity",
            model : config.model,
            fetch : config.fetch,
            filters : config.filters,
            listeners : {
                scope : this,
                load : function(store, data) {
                    callback(null,data);
                }
            }
        };

        if (!_.isUndefined(config.context)) {
        	storeConfig["context"] = config.context;
        }
        
        Ext.create('Rally.data.WsapiDataStore', storeConfig);
    }

});
