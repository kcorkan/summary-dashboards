Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {
        //Write app code here
        //API Docs: https://help.rallydev.com/apps/2.0/doc/
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
            that.readWorkItems.bind(that),
            that.groupWorkItems.bind(that),
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
            that.reportProjects.push( _.find(that.projects,function(project){
                return project.get("ObjectID") === that.getContext().getProject().ObjectID;
            }))
        }

        console.log("report:",_.map(that.reportProjects,function(p){return p.get("Name");}));

        callback(null);

    },

    readWorkItems : function(callback) {

        var that = this;

        var configs = _.map(["HierarchicalRequirement","Defect"],function(model){
            return {
                model : model,
                filters : [that.workItemFilter],
                fetch : ["ObjectID","ScheduleState","PlanEstimate","Project"]
            };
        });
        console.log("configs",configs);

        async.map( configs, that._wsapiQuery, function(error,results) {
            var allItems = [];
            _.each(results,function(result){
                allItems = allItems.concat(result);
            });
            // console.log("work items",results);
            callback(null,allItems);
        });

    },

    groupWorkItems : function(workItems, callback) {

        var that = this;

        // work items are either directly in the parent item or in a child project.
        var groupedByParent = _.groupBy( workItems, function (workItem) {

            // first get the full project object (so we can get it's parent)
            var p = _.find(that.projects,function(allProject) { 
                return workItem.get("Project").ObjectID === allProject.get("ObjectID");
            });

            // then find the report project for this item
            var reportProject = _.find(that.reportProjects,function(reportP) {
                // console.log(p.get("Parent")._ref,reportP.get("_ref"));
                if ( reportP.get("_ref") === p.get("_ref")) {
                    return true;
                }
                if ( ( !_.isNull(p.get("Parent")) && p.get("Parent")._ref === reportP.get("_ref"))) {
                    return true;
                }
                return false;
            });
            return (!_.isUndefined(reportProject) && !_.isNull(reportProject)) ? reportProject.get("Name") : "None";

        });
        callback(null,groupedByParent);

    },

    prepareChartData : function(groupedWorkItems,callback) {

        var that = this;

        var projectKeys = _.compact(_.map(_.keys(groupedWorkItems),function(k) { return k !== "None" ? k : null; }));

        var pointsValue = function(value) {
            return !_.isUndefined(value) && !_.isNull(value) ? value : 0;
        };

        // totals points for a set of work items based on if they are in a set of states
        var summarize = function( workItems, states ) {

            // calc total points
            var total = _.reduce(workItems,
                function(memo,workItem) {
                    return memo + pointsValue(workItem.get("PlanEstimate"));
                },0
            );

            var stateTotal = _.reduce( 
                workItems, 
                function(memo,workItem) {

                    return memo + 
                        ( _.indexOf(states,workItem.get("ScheduleState")) > -1 ? 
                            pointsValue(workItem.get("PlanEstimate")) :
                            0);
                },0
            );

            var p = ( total > 0 ? ((stateTotal/total)*100) : 0);

            return Math.round(p);
            
        };

        var summary = that.createSummaryRecord();

        var categories = projectKeys;

        var seriesData = _.map( _.keys(summary), function( summaryKey ) {
            return {
                name : summaryKey,
                data : _.map( projectKeys, function( projectKey ) {
                    return summarize( groupedWorkItems[projectKey], summary[summaryKey]);
                })
            };
        });

        callback(null,categories,seriesData);

    },

    createChart : function(categories,seriesData,callback) {

        var that = this;

        if (!_.isUndefined(that.chart)) {
            that.remove(that.chart);
        }

        that.chart = Ext.create('Rally.technicalservices.bmChart', {
         // xtype: 'tskickbackchart',
            itemId: 'rally-chart',
            chartData: { series : seriesData, categories : categories },
            // chartColors : [],
            title: 'Progress By Project'
        });

        that.add(that.chart);

        var chart = this.down("#rally-chart");
        var p = Ext.get(chart.id);
        elems = p.query("div.x-mask");
        _.each(elems, function(e) { e.remove(); });
        var elems = p.query("div.x-mask-msg");
        _.each(elems, function(e) { e.remove(); });
    },


    // utilities below here ... 

    createSummaryRecord : function() { 

        var that = this;
      
        var summary = {
            "Backlog" : ["Defined"],
            "In-Progress" : ["In-Progress"],
            "Completed/Accepted" : ["Completed","Accepted"]
        };

        // add initial and last states if necessary
        var first = _.first(that.scheduleStates);
        var last = _.last(that.scheduleStates);
        if (_.indexOf(summary[_.first(_.keys(summary))],first)===-1)
            summary[_.first(_.keys(summary))].push(_.first(that.scheduleStates));
        if (_.indexOf(summary[_.last(_.keys(summary))],last)===-1)
            summary[_.last(_.keys(summary))].push(_.last(that.scheduleStates));

        console.log("summary",summary);
        return summary;

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
        
        Ext.create('Rally.data.WsapiDataStore', {
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
        });
    }

});
