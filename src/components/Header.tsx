import { Button, Menu, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Tooltip } from '@fluentui/react-components';
import { ArrowDownloadRegular, CloudRegular, GlobeRegular, HeartFilled, PersonRegular, PlayFilled, QuestionCircleRegular, SettingsRegular } from '@fluentui/react-icons';
import logo from '../assets/logo.png';
import { useStrings } from '../i18n/I18nContext';
import { AppTitle, AuthorName, type Language } from '../i18n/strings';

const LinkedInUrl = 'https://www.linkedin.com/in/hamza-amraoui/';
const DonateUrl = 'https://www.paypal.com/paypalme/EntityFieldsAnalyser';

/** Opens an external page (falls back to the connection browser when the host blocks window.open). */
export async function openUrl(url: string) {
    try {
        const opened = window.open(url, '_blank', 'noopener');
        if (!opened) await window.toolboxAPI.utils.openInConnectionBrowser(url);
    } catch (error) {
        console.error(`ServiceBus Explorer: unable to open ${url}`, error);
    }
}

interface HeaderProps {
    connectionName?: string | null;
    language: Language;
    busy: boolean;
    onLoad: () => void;
    onConnections: () => void;
    onExport: () => void;
    onOptions: () => void;
    onHelp: () => void;
    onLanguage: (language: Language) => void;
}

/**
 * Gradient header: logo, title, connection, toolbar (port of the ToolStrip header of the XrmToolBox version).
 */
export function Header(props: HeaderProps) {
    const strings = useStrings();

    return (
        <header className="sb-header">
            <div className="sb-brand">
                <img src={logo} alt="" className="sb-logo" />
                <div>
                    <div className="sb-title">{AppTitle}</div>
                    <div className="sb-subtitle">{strings.appSubtitle}</div>
                </div>
            </div>

            <div className="sb-header-tools">
                <span className={props.connectionName ? 'sb-connection sb-connection-on' : 'sb-connection'}>
                    {props.connectionName ? `● ${strings.connectedTo(props.connectionName)}` : `○ ${strings.notConnected}`}
                </span>

                <Tooltip content={strings.loadTip} relationship="description">
                    <Button appearance="primary" className="sb-load" icon={<PlayFilled />} onClick={props.onLoad} disabled={props.busy}>
                        {strings.load}
                    </Button>
                </Tooltip>
                <Button appearance="transparent" className="sb-header-button" icon={<CloudRegular />} onClick={props.onConnections} disabled={props.busy}>
                    {strings.connections}
                </Button>
                <Tooltip content={strings.exportTip} relationship="description">
                    <Button appearance="transparent" className="sb-header-button" icon={<ArrowDownloadRegular />} onClick={props.onExport} disabled={props.busy}>
                        {strings.exportReport}
                    </Button>
                </Tooltip>
                <Button appearance="transparent" className="sb-header-button" icon={<SettingsRegular />} onClick={props.onOptions} disabled={props.busy}>
                    {strings.options}
                </Button>

                <Menu checkedValues={{ language: [props.language] }} onCheckedValueChange={(_e, data) => props.onLanguage(data.checkedItems[0] as Language)}>
                    <MenuTrigger disableButtonEnhancement>
                        <Button appearance="transparent" className="sb-header-button" icon={<GlobeRegular />} title={strings.languageMenu}>
                            {props.language === 'fr' ? 'Français' : 'English'}
                        </Button>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItemRadio name="language" value="en">
                                English
                            </MenuItemRadio>
                            <MenuItemRadio name="language" value="fr">
                                Français
                            </MenuItemRadio>
                        </MenuList>
                    </MenuPopover>
                </Menu>

                <Button appearance="transparent" className="sb-header-button" icon={<QuestionCircleRegular />} onClick={props.onHelp}>
                    {strings.help}
                </Button>
                <Button appearance="transparent" className="sb-header-button" icon={<PersonRegular />} title={strings.authorTip} onClick={() => openUrl(LinkedInUrl)}>
                    {AuthorName}
                </Button>
                <Button appearance="transparent" className="sb-header-button" icon={<HeartFilled className="sb-heart" />} title={strings.donateTip} onClick={() => openUrl(DonateUrl)}>
                    {strings.donate}
                </Button>
            </div>
        </header>
    );
}
