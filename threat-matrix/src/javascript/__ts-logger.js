/*
 */
Ext.define('Rally.technicalservices.Logger',{
    constructor: function(config){
        Ext.apply(this,config);
    },
    log: function(){
        var timestamp = "[ " + Ext.util.Format.date(new Date(), "Y-m-d H:i:s.u") + " ]";
        var i = -1, l = arguments.length, args = [], fn = 'console.log(args)';
        while(++i<l){
            args.push('args['+i+']');
        };
        fn = new Function('args',fn.replace(/args/,args.join(',')));
        fn(arguments);
    }

});
