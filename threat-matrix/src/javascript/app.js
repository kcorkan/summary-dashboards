Ext.define("threat-matrix", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    items: [
        {xtype:'container',itemId:'settings_box'},
    ],

    config: {
        defaultSettings: {
            minAgeThreshhold:  1,
            maxFeatureAgeThreshhold: 56,
            maxStoryAgeThreshhold: 14,
            minPointsThreshhold: 1,
            andMinThreshholds: true,
            featureSizeMultiplier: 1,
            storySizeMultiplier: 1,
            riskMultiplier: 2,
            showDataLabels: true,
            showDependencyColors: false
        }
    },
    storyFetchFields: ['FormattedID','c_Risk','PlanEstimate','Project','ScheduleState','InProgressDate','Blocked','Blocker','CreationDate','Feature','Name','Predecessors'],
    featureFetchFields: ['FormattedID','Project','ActualStartDate','ActualEndDate','LeafStoryPlanEstimateTotal', 'LeafStoryCount','Name', 'c_Risk'], //,'Predecessors'],
    portfolioItemFeature: 'PortfolioItem/Feature',
    projectFetchFields: ['Name','Parent','ObjectID'],
    riskField: 'c_Risk',
    ageGranularity: 'day',

    launch: function() {
        if (this.isExternal()){
            this.showSettings(this.config);
        } else {
            this.onSettingsUpdate(this.getSettings());
        }
    },

    getReleaseFilters: function(release){

        if (!release){
            release = this.getReleaseRecord();
        }

        return [{
            property: 'Release.Name',
            value: release.get('Name')
        },{
            property: 'Release.ReleaseStartDate',
            value: Rally.util.DateTime.toIsoString(release.get('ReleaseStartDate'))
        },{
            property: 'Release.ReleaseDate',
            value: Rally.util.DateTime.toIsoString(release.get('ReleaseDate'))
        }];
    },

    getStoryFilters: function(release, iteration){
        this.logger.log('getStoryFilters',release,iteration);
        var filters = this.getReleaseFilters(release);

        var iteration_start_date = Rally.util.DateTime.toIsoString(iteration.get('StartDate')),
            iteration_end_date = Rally.util.DateTime.toIsoString(iteration.get('EndDate'));

        filters = filters.concat([{
            property: 'Iteration.StartDate',
            value: iteration_start_date
        },{
            property: 'Iteration.EndDate',
            value: iteration_end_date
        },{
            property: 'Iteration.Name',
            value: iteration.get('Name')
        },{
            property: 'ScheduleState',
            value: 'In-Progress'
        }]);

        filters = Rally.data.wsapi.Filter.and(filters);

        this.logger.log('filters', filters.toString());
        return filters;
    },

    onTimeboxUpdated: function(release, iteration){
        //comment out once we get the message bus working
        iteration = this.getIterationRecord(),
        release = this.getReleaseRecord();

        this.logger.log('onTimeboxUpdated',release, iteration);
        if (release && iteration){
            this.getBody().removeAll();
            this.setLoading(true);

            var days_in_iteration = Rally.util.DateTime.getDifference(new Date(iteration.get('EndDate')),new Date(iteration.get('StartDate')), 'hour')/24;
            var days_in_release = Rally.util.DateTime.getDifference(new Date(release.get('ReleaseDate')),new Date(release.get('ReleaseStartDate')), 'hour')/24;

            var promises = [
                this._fetchData(this.portfolioItemFeature, this.featureFetchFields, this.getReleaseFilters(release)),
                this._fetchData('HierarchicalRequirement', this.storyFetchFields, this.getStoryFilters(release, iteration)),
                this._fetchData('Project', this.projectFetchFields,[])
            ];

            Deft.Promise.all(promises).then({
                scope: this,
                success: function(records){

                    this.logger.log('_fetchData success', records);

                    var calc = Ext.create('Rally.technicalservices.ThreatCalculator',{
                        riskField: this.riskField,
                        currentProjectRef: this.getContext().getProjectRef(),
                        projects: records[2],
                        minAgeThreshhold: this.getSetting('minAgeThreshhold'),
                        maxFeatureAgeThreshhold: this.getSetting('maxFeatureAgeThreshhold'),
                        maxStoryAgeThreshhold: this.getSetting('maxStoryAgeThreshhold'),
                        minPointsThreshhold: this.getSetting('minPointsThreshhold'),
                        featureSizeMultiplier: this.getSetting('featureSizeMultiplier'),
                        storySizeMultiplier: this.getSetting('storySizeMultiplier'),
                        riskMultiplier: this.getSetting('riskMultiplier'),
                        iterationDays: days_in_iteration,
                        releaseDays: days_in_release,
                        showDataLabels: this.getSetting('showDataLabels'),
                        showDependencyColors: this.getSetting('showDependencyColors')
                    });

                    calc.runCalculation(records[0],records[1]).then({
                        scope: this,
                        success: function(chartData){
                            this.setLoading(false);
                            this.logger.log('runCalculation success series', chartData)

                            this.getBody().add({
                                xtype: 'tsthreatchart',
                                itemId: 'rally-chart',
                                loadMask: false,
                                chartData: chartData,
                                title: 'Threat Matrix'
                            });
                            this._addLegend(calc.projectLabelColorMap);

                        },
                        failure: function(operation){
                            this.setLoading(false);
                            this.logger.log('failure in runCalcuation');
                        }
                    });
                    },
                failure: function(operation){
                    this.setLoading(false);
                    this.logger.log('_fetchData failure', operation);
                }
            });
        }
    },
    _addLegend: function(colorMap){
        this.logger.log('_addLegend',colorMap);

        if (this.down('#ct-legend')){
            this.down('#ct-legend').destroy();
        }
        var ct_legend = this.add({
            xtype: 'container',
            itemId: 'ct-legend',
            layout: {type: 'vbox'}
        });

        var color_data = [];
        _.each(colorMap, function(color, label){
            color_data.push({color: color, label: label});
        });
        this.logger.log('_addLegend',color_data);
        var ct = ct_legend.add({
            xtype: 'container',
            padding: 10,
            tpl: '<div class="tslegendtext">Projects:  </div><tpl for="."><div class="tslegend" style="background-color:{color}">&nbsp;&nbsp;</div><div class="tslegendtext">&nbsp;&nbsp;{label}</div><span class="tslegendspacer">&nbsp;</span></tpl>'
        });
        ct.update(color_data);

        var ct2 = ct_legend.add({
            xtype: 'container',
            padding: 10,
            html: '<div class="tslegendtext">Types:  </div><div class="tslegend-square">&nbsp;&nbsp;</div><div class="tslegendtext">&nbsp;&nbsp;Feature</div><span class="tslegendspacer">&nbsp;</span>' +
                '<div class="tslegend-circle">&nbsp;&nbsp;</div><div class="tslegendtext">&nbsp;&nbsp;User Story (50% Opacity)</div><span class="tslegendspacer">&nbsp;</span>'
        });


    },
    _fetchData: function(modelType, fetchFields, filters){
        this.logger.log('_fetchData',modelType, fetchFields, filters);
        var deferred = Ext.create('Deft.Deferred'),
            store = Ext.create('Rally.data.wsapi.Store',{
                model: modelType,
                limit: 'Infinity',
                fetch: fetchFields,
                filters: filters,
                context: {
                    workspace: this.getContext().getWorkspace()._ref,
                    project: this.getContext().getProjectRef(),
                    projectScopeDown: this.getContext().getProjectScopeDown(),
                    projectScopeUp: false
                }
            });

        store.load({
            scope: this,
            callback: function(records, operation, success){
                if (success){
                    deferred.resolve(records);
                } else {
                    deferred.reject(operation);
                }
            }
        });
        return deferred;
    },
    addComponents: function(){
        this.logger.log('addComponents');
        var cb = this.getHeader().add({
            xtype: 'rallyreleasecombobox',
            itemId: 'cb-release',
            fieldLabel: 'Release',
            labelAlign: 'right',
            allowNoEntry: false,
            width: '300'
        });
        cb.on('change', this.onTimeboxUpdated,this);

        var cb = this.getHeader().add({
            xtype: 'rallyiterationcombobox',
            itemId: 'cb-iteration',
            fieldLabel: 'Iteration',
            labelAlign: 'right',
            allowNoEntry: false,
            width: '300'
        });
        cb.on('change', this.onTimeboxUpdated,this);

        this.getHeader().add({
            xtype: 'rallybutton',
            itemId: 'bt-dependency',
            cls: 'small-icon secondary rly-small',
            width: 35,
            iconCls: 'icon-predecessor',
           // icon: 'icon-predecessor',
            scope: this,
            handler: this._toggleDependencies,
            tooltip: 'Show first level dependency relationships'
        });
    },
    _toggleDependencies: function(btn){
        this.logger.log('_toggleDependencies', btn.cls.toString(), btn.cls.indexOf("primary"));
        var hideDependencies = btn.cls.indexOf("primary") > -1;

        if (hideDependencies){
            btn.cls = 'small-icon secondary rly-small';
            btn.removeCls('primary');
            btn.addCls('secondary');
            btn.tooltip = 'Show first level dependency relationships';
        } else {
            btn.removeCls('secondary');
            btn.addCls('primary');
            btn.cls = 'small-icon primary rly-small';
            btn.tooltip = 'Hide first level dependency relationships';
        }

        var chart = this.down('#rally-chart').items.items[1].items.items[0];
        _.each(chart.chart.series, function(s){
            s.data[0].select(hideDependencies != true, hideDependencies != true);
        });
    },
    getIterationRecord: function(){
        if (this.down('#cb-iteration')){
            return this.down('#cb-iteration').getRecord();
        }
        return null;
    },
    getReleaseRecord: function(){
        if (this.down('#cb-release')){
            return this.down('#cb-release').getRecord();
        }
        return null;
    },
    getHeader: function(){
        this.logger.log('getHeader');

        if (this.down('#ct-header')){
            return this.down('#ct-header');
        }

        return this.add({
            xtype: 'container',
            itemId: 'ct-header',
            layout: {type: 'hbox'}
        });
    },

    getBody: function(){
        this.logger.log('getBody');

        if (this.down('#ct-body')){
            return this.down('#ct-body');
        }
        return this.add({
            xtype: 'container',
            itemId: 'ct-body'
        });
    },
    /********************************************
     /* Overrides for App class
     /*
     /********************************************/
    //getSettingsFields:  Override for App
    getSettingsFields: function() {
        var me = this;

        return [
            {
                name: 'maxFeatureAgeThreshhold',
                xtype: 'rallynumberfield',
                fieldLabel: 'Max Feature age threshold (days)',
                labelWidth: 200,
                labelAlign: 'right',
                minValue: 0
            },            {
                name: 'maxStoryAgeThreshhold',
                xtype: 'rallynumberfield',
                fieldLabel: 'Max User Story age threshold (days)',
                labelWidth: 200,
                labelAlign: 'right',
                minValue: 0,
                margin: '0 0 20 0'
            },{
                name: 'minAgeThreshhold',
                xtype: 'rallynumberfield',
                fieldLabel: 'Min age threshold (days)',
                labelWidth: 200,
                labelAlign: 'right',
                 minValue: 0
            },{
                name: 'minPointsThreshhold',
                xtype: 'rallynumberfield',
                fieldLabel: 'Min points threshold',
                labelWidth: 200,
                labelAlign: 'right',
                 minValue: 0
            },{
                name: 'andMinThreshholds',
                xtype: 'rallycheckboxfield',
                boxLabelAlign: 'after',
                fieldLabel: '',
                margin: '0 0 25 200',
                boxLabel: 'Use <b>AND</b> query to exclude items by threshold.<br/><span style="color:#999999;"><i>If checked, exclude artifacts if their age <b>AND</b> points are below the minimum threshold.<br/> If unchecked, exclude artifacts if either age <b>OR</b> points are below the minimum threshold.</i></span>'
            },{
                name: 'featureSizeMultiplier',
                xtype: 'rallynumberfield',
                fieldLabel: 'Feature Size Multiplier',
                labelWidth: 200,
                labelAlign: 'right',
                 minValue: 0
            },{
                name: 'storySizeMultiplier',
                xtype: 'rallynumberfield',
                fieldLabel: 'Story Size Multiplier',
                labelWidth: 200,
                labelAlign: 'right',
                minValue: 0
            },{
                name: 'riskMultiplier',
                xtype: 'rallynumberfield',
                fieldLabel: 'Risk Multiplier for User Stories',
                labelWidth: 200,
                labelAlign: 'right',
                 minValue: 0,
                 margin: '0 0 20 0'
            },{
                name: 'showDataLabels',
                xtype: 'rallycheckboxfield',
                boxLabelAlign: 'after',
                fieldLabel: '',
                margin: '0 0 0 200',
                boxLabel: 'Show data labels'
            },{
                name: 'showDependencyColors',
                xtype: 'rallycheckboxfield',
                boxLabelAlign: 'after',
                fieldLabel: '',
                margin: '0 0 0 200',
                boxLabel: 'Show colored dependencies'
            }

        ];
    },
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    //showSettings:  Override
    showSettings: function(options) {
        this._appSettings = Ext.create('Rally.app.AppSettings', Ext.apply({
            fields: this.getSettingsFields(),
            settings: this.getSettings(),
            defaultSettings: this.getDefaultSettings(),
            context: this.getContext(),
            settingsScope: this.settingsScope,
            autoScroll: true
        }, options));

        this._appSettings.on('cancel', this._hideSettings, this);
        this._appSettings.on('save', this._onSettingsSaved, this);
        if (this.isExternal()){
            if (this.down('#settings_box').getComponent(this._appSettings.id)==undefined){
                this.down('#settings_box').add(this._appSettings);
            }
        } else {
            this.hide();
            this.up().add(this._appSettings);
        }
        return this._appSettings;
    },
    _onSettingsSaved: function(settings){
        Ext.apply(this.settings, settings);
        this._hideSettings();
        this.onSettingsUpdate(settings);
    },
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        Ext.apply(this, settings);
        this.addComponents();
    }
});