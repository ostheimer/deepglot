/**
 * Deepglot "Sprachschalter" block (editor side).
 *
 * Tiny wrapper around `wp.serverSideRender` so the block preview inside
 * the editor matches exactly what visitors see — no second copy of the
 * markup, no risk of editor / frontend drift. The actual HTML is
 * produced by SwitcherBlock::render() in PHP.
 */
( function ( blocks, element, serverSideRender, i18n, components, blockEditor ) {
    if ( ! blocks || ! blocks.registerBlockType ) {
        return;
    }

    var el = element.createElement;
    var __ = i18n && i18n.__ ? i18n.__ : function ( s ) { return s; };

    blocks.registerBlockType( 'deepglot/switcher', {
        apiVersion: 3,
        title: __( 'Deepglot Sprachschalter', 'deepglot' ),
        description: __(
            'Zeigt den Deepglot Sprachschalter. Stil, Flagge und Reihenfolge folgen den Plugin-Einstellungen.',
            'deepglot'
        ),
        category: 'widgets',
        icon: 'translation',
        supports: {
            html: false,
            align: [ 'left', 'center', 'right' ],
        },

        attributes: {
            instanceId: { type: 'string', default: 'default' },
        },

        edit: function ( props ) {
            // serverSideRender hits the REST API → PHP render callback
            // → same markup the visitor gets.
            var preview = el( serverSideRender, {
                block: 'deepglot/switcher',
                attributes: props.attributes,
            } );

            if ( ! components || ! components.TextControl || ! blockEditor || ! blockEditor.InspectorControls ) {
                return preview;
            }

            return el( element.Fragment, {},
                el( blockEditor.InspectorControls, {},
                    el( components.PanelBody, { title: __( 'Switcher-Instanz', 'deepglot' ) },
                        el( components.TextControl, {
                            label: __( 'Instanz-ID', 'deepglot' ),
                            help: __( 'Die ID findest du unter Einstellungen → Deepglot → Sprachumschalter.', 'deepglot' ),
                            value: props.attributes.instanceId || 'default',
                            onChange: function ( value ) {
                                props.setAttributes( { instanceId: value } );
                            },
                        } )
                    )
                ),
                preview
            );
        },

        // Dynamic block — output is rendered by PHP. WP wants `save` to
        // return null so post_content stays clean (only the block
        // comment marker is saved).
        save: function () {
            return null;
        },
    } );
} )(
    window.wp && window.wp.blocks,
    window.wp && window.wp.element,
    window.wp && window.wp.serverSideRender,
    window.wp && window.wp.i18n,
    window.wp && window.wp.components,
    window.wp && window.wp.blockEditor
);
