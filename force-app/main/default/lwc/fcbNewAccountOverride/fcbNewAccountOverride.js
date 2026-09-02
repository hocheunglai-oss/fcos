import { LightningElement , api, track, wire} from 'lwc';
import LightningConfirm from 'lightning/confirm';
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import ACCOUNT_OBJECT from '@salesforce/schema/Account';

export default class FcbNewAccountOverride extends LightningElement {
  @api recordType;
  @track isBroker;
  @track isAgent = false;
  @track shippingAddress = {
    street: "",
    city: "",
    province: "",
    postalCode: "",
    country: "",
  };
  @track billingAddress = {
    street: "",
    city: "",
    province: "",
    postalCode: "",
    country: "",
  };

  @track shippingDisabled = false;
  @track billingDisabled = false;
  buttonName;
  @track isDisabledBroker;

  countryOptions = [
    { label: "Afghanistan", value: "AF" },
    { label: "Aland Islands", value: "AX" },
    { label: "Albania", value: "AL" },
    { label: "Algeria", value: "DZ" },
    { label: "Andorra", value: "AD" },
    { label: "Angola", value: "AO" },
    { label: "Anguilla", value: "AI" },
    { label: "Antarctica", value: "AQ" },
    { label: "Antigua and Barbuda", value: "AG" },
    { label: "Argentina", value: "AR" },
    { label: "Armenia", value: "AM" },
    { label: "Aruba", value: "AW" },
    { label: "Australia", value: "AU" },
    { label: "Austria", value: "AT" },
    { label: "Azerbaijan", value: "AZ" },
    { label: "Bahamas", value: "BS" },
    { label: "Bahrain", value: "BH" },
    { label: "Bangladesh", value: "BD" },
    { label: "Barbados", value: "BB" },
    { label: "Belarus", value: "BY" },
    { label: "Belgium", value: "BE" },
    { label: "Belize", value: "BZ" },
    { label: "Benin", value: "BJ" },
    { label: "Bermuda", value: "BM" },
    { label: "Bhutan", value: "BT" },
    { label: "Bolivia, Plurinational State of", value: "BO" },
    { label: "Bonaire, Sint Eustatius and Saba", value: "BQ" },
    { label: "Bosnia and Herzegovina", value: "BA" },
    { label: "Botswana", value: "BW" },
    { label: "Bouvet Island", value: "BV" },
    { label: "Brazil", value: "BR" },
    { label: "British Indian Ocean Territory", value: "IO" },
    { label: "Brunei Darussalam", value: "BN" },
    { label: "Bulgaria", value: "BG" },
    { label: "Burkina Faso", value: "BF" },
    { label: "Burundi", value: "BI" },
    { label: "Cambodia", value: "KH" },
    { label: "Cameroon", value: "CM" },
    { label: "Canada", value: "CA" },
    { label: "Cape Verde", value: "CV" },
    { label: "Cayman Islands", value: "KY" },
    { label: "Central African Republic", value: "CF" },
    { label: "Chad", value: "TD" },
    { label: "Chile", value: "CL" },
    { label: "China", value: "CN" },
    { label: "Taiwan", value: "TW" },
    { label: "Christmas Island", value: "CX" },
    { label: "Cocos (Keeling) Islands", value: "CC" },
    { label: "Colombia", value: "CO" },
    { label: "Comoros", value: "KM" },
    { label: "Congo", value: "CG" },
    { label: "Congo, the Democratic Republic of the", value: "CD" },
    { label: "Cook Islands", value: "CK" },
    { label: "Costa Rica", value: "CR" },
    { label: "Cote d'Ivoire", value: "CI" },
    { label: "Croatia", value: "HR" },
    { label: "Cuba", value: "CU" },
    { label: "Curaçao", value: "CW" },
    { label: "Cyprus", value: "CY" },
    { label: "Czech Republic", value: "CZ" },
    { label: "Denmark", value: "DK" },
    { label: "Djibouti", value: "DJ" },
    { label: "Dominica", value: "DM" },
    { label: "Dominican Republic", value: "DO" },
    { label: "Ecuador", value: "EC" },
    { label: "Egypt", value: "EG" },
    { label: "El Salvador", value: "SV" },
    { label: "Equatorial Guinea", value: "GQ" },
    { label: "Eritrea", value: "ER" },
    { label: "Estonia", value: "EE" },
    { label: "Ethiopia", value: "ET" },
    { label: "Falkland Islands (Malvinas)", value: "FK" },
    { label: "Faroe Islands", value: "FO" },
    { label: "Fiji", value: "FJ" },
    { label: "Finland", value: "FI" },
    { label: "France", value: "FR" },
    { label: "French Guiana", value: "GF" },
    { label: "French Polynesia", value: "PF" },
    { label: "French Southern Territories", value: "TF" },
    { label: "Gabon", value: "GA" },
    { label: "Gambia", value: "GM" },
    { label: "Georgia", value: "GE" },
    { label: "Germany", value: "DE" },
    { label: "Ghana", value: "GH" },
    { label: "Gibraltar", value: "GI" },
    { label: "Greece", value: "GR" },
    { label: "Greenland", value: "GL" },
    { label: "Grenada", value: "GD" },
    { label: "Guadeloupe", value: "GP" },
    { label: "Guatemala", value: "GT" },
    { label: "Guernsey", value: "GG" },
    { label: "Guinea", value: "GN" },
    { label: "Guinea-Bissau", value: "GW" },
    { label: "Guyana", value: "GY" },
    { label: "Haiti", value: "HT" },
    { label: "Heard Island and McDonald Islands", value: "HM" },
    { label: "Holy See (Vatican City State)", value: "VA" },
    { label: "Honduras", value: "HN" },
    { label: "Hong Kong", value: "HK" },
    { label: "Hungary", value: "HU" },
    { label: "Iceland", value: "IS" },
    { label: "India", value: "IN" },
    { label: "Indonesia", value: "ID" },
    { label: "Iran, Islamic Republic of", value: "IR" },
    { label: "Iraq", value: "IQ" },
    { label: "Ireland", value: "IE" },
    { label: "Isle of Man", value: "IM" },
    { label: "Israel", value: "IL" },
    { label: "Italy", value: "IT" },
    { label: "Jamaica", value: "JM" },
    { label: "Japan", value: "JP" },
    { label: "Jersey", value: "JE" },
    { label: "Jordan", value: "JO" },
    { label: "Kazakhstan", value: "KZ" },
    { label: "Kenya", value: "KE" },
    { label: "Kiribati", value: "KI" },
    { label: "Korea, Democratic People's Republic of", value: "KP" },
    { label: "Korea, Republic of", value: "KR" },
    { label: "Kuwait", value: "KW" },
    { label: "Kyrgyzstan", value: "KG" },
    { label: "Lao People's Democratic Republic", value: "LA" },
    { label: "Latvia", value: "LV" },
    { label: "Lebanon", value: "LB" },
    { label: "Lesotho", value: "LS" },
    { label: "Liberia", value: "LR" },
    { label: "Libyan Arab Jamahiriya", value: "LY" },
    { label: "Liechtenstein", value: "LI" },
    { label: "Lithuania", value: "LT" },
    { label: "Luxembourg", value: "LU" },
    { label: "Macao", value: "MO" },
    { label: "Macedonia, the former Yugoslav Republic of", value: "MK" },
    { label: "Madagascar", value: "MG" },
    { label: "Malawi", value: "MW" },
    { label: "Malaysia", value: "MY" },
    { label: "Maldives", value: "MV" },
    { label: "Mali", value: "ML" },
    { label: "Malta", value: "MT" },
    { label: "Martinique", value: "MQ" },
    { label: "Mauritania", value: "MR" },
    { label: "Mauritius", value: "MU" },
    { label: "Mayotte", value: "YT" },
    { label: "Mexico", value: "MX" },
    { label: "Moldova, Republic of", value: "MD" },
    { label: "Monaco", value: "MC" },
    { label: "Mongolia", value: "MN" },
    { label: "Montenegro", value: "ME" },
    { label: "Montserrat", value: "MS" },
    { label: "Morocco", value: "MA" },
    { label: "Mozambique", value: "MZ" },
    { label: "Myanmar", value: "MM" },
    { label: "Namibia", value: "NA" },
    { label: "Nauru", value: "NR" },
    { label: "Nepal", value: "NP" },
    { label: "Netherlands", value: "NL" },
    { label: "New Caledonia", value: "NC" },
    { label: "New Zealand", value: "NZ" },
    { label: "Nicaragua", value: "NI" },
    { label: "Niger", value: "NE" },
    { label: "Nigeria", value: "NG" },
    { label: "Niue", value: "NU" },
    { label: "Norfolk Island", value: "NF" },
    { label: "Norway", value: "NO" },
    { label: "Oman", value: "OM" },
    { label: "Pakistan", value: "PK" },
    { label: "Palestinian Territory, Occupied", value: "PS" },
    { label: "Panama", value: "PA" },
    { label: "Papua New Guinea", value: "PG" },
    { label: "Paraguay", value: "PY" },
    { label: "Peru", value: "PE" },
    { label: "Philippines", value: "PH" },
    { label: "Pitcairn", value: "PN" },
    { label: "Poland", value: "PL" },
    { label: "Portugal", value: "PT" },
    { label: "Qatar", value: "QA" },
    { label: "Reunion", value: "RE" },
    { label: "Romania", value: "RO" },
    { label: "Russian Federation", value: "RU" },
    { label: "Rwanda", value: "RW" },
    { label: "Saint Barthélemy", value: "BL" },
    { label: "Saint Helena, Ascension and Tristan da Cunha", value: "SH" },
    { label: "Saint Kitts and Nevis", value: "KN" },
    { label: "Saint Lucia", value: "LC" },
    { label: "Saint Martin (French part)", value: "MF" },
    { label: "Saint Pierre and Miquelon", value: "PM" },
    { label: "Saint Vincent and the Grenadines", value: "VC" },
    { label: "Samoa", value: "WS" },
    { label: "San Marino", value: "SM" },
    { label: "Sao Tome and Principe", value: "ST" },
    { label: "Saudi Arabia", value: "SA" },
    { label: "Senegal", value: "SN" },
    { label: "Serbia", value: "RS" },
    { label: "Seychelles", value: "SC" },
    { label: "Sierra Leone", value: "SL" },
    { label: "Singapore", value: "SG" },
    { label: "Sint Maarten (Dutch part)", value: "SX" },
    { label: "Slovakia", value: "SK" },
    { label: "Slovenia", value: "SI" },
    { label: "Solomon Islands", value: "SB" },
    { label: "Somalia", value: "SO" },
    { label: "South Africa", value: "ZA" },
    { label: "South Georgia and the South Sandwich Islands", value: "GS" },
    { label: "South Sudan", value: "SS" },
    { label: "Spain", value: "ES" },
    { label: "Sri Lanka", value: "LK" },
    { label: "Sudan", value: "SD" },
    { label: "Suriname", value: "SR" },
    { label: "Svalbard and Jan Mayen", value: "SJ" },
    { label: "Swaziland", value: "SZ" },
    { label: "Sweden", value: "SE" },
    { label: "Switzerland", value: "CH" },
    { label: "Syrian Arab Republic", value: "SY" },
    { label: "Tajikistan", value: "TJ" },
    { label: "Tanzania, United Republic of", value: "TZ" },
    { label: "Thailand", value: "TH" },
    { label: "Timor-Leste", value: "TL" },
    { label: "Togo", value: "TG" },
    { label: "Tokelau", value: "TK" },
    { label: "Tonga", value: "TO" },
    { label: "Trinidad and Tobago", value: "TT" },
    { label: "Tunisia", value: "TN" },
    { label: "Turkey", value: "TR" },
    { label: "Turkmenistan", value: "TM" },
    { label: "Turks and Caicos Islands", value: "TC" },
    { label: "Tuvalu", value: "TV" },
    { label: "Uganda", value: "UG" },
    { label: "Ukraine", value: "UA" },
    { label: "United Arab Emirates", value: "AE" },
    { label: "United Kingdom", value: "GB" },
    { label: "United States", value: "US" },
    { label: "Uruguay", value: "UY" },
    { label: "Uzbekistan", value: "UZ" },
    { label: "Vanuatu", value: "VU" },
    { label: "Venezuela, Bolivarian Republic of", value: "VE" },
    { label: "Viet Nam", value: "VN" },
    { label: "Virgin Islands, British", value: "VG" },
    { label: "Wallis and Futuna", value: "WF" },
    { label: "Western Sahara", value: "EH" },
    { label: "Yemen", value: "YE" },
    { label: "Zambia", value: "ZM" },
    { label: "Zimbabwe", value: "ZW" },
  ];

  provinceMap = {
    AU: [
      { label: "Australian Capital Territory", value: "ACT" },
      { label: "New South Wales", value: "NSW" },
      { label: "Northern Territory", value: "NT" },
      { label: "Queensland", value: "QLD" },
      { label: "South Australia", value: "SA" },
      { label: "Tasmania", value: "TAS" },
      { label: "Victoria", value: "VIC" },
      { label: "Western Australia", value: "WA" },
    ],
    BR: [
      { label: "Acre", value: "AC" },
      { label: "Alagoas", value: "AL" },
      { label: "Amapá", value: "AP" },
      { label: "Amazonas", value: "AM" },
      { label: "Bahia", value: "BA" },
      { label: "Ceará", value: "CE" },
      { label: "Distrito Federal", value: "DF" },
      { label: "Espírito Santo", value: "ES" },
      { label: "Goiás", value: "GO" },
      { label: "Maranhão", value: "MA" },
      { label: "Mato Grosso", value: "MT" },
      { label: "Mato Grosso do Sul", value: "MS" },
      { label: "Minas Gerais", value: "MG" },
      { label: "Pará", value: "PA" },
      { label: "Paraíba", value: "PB" },
      { label: "Paraná", value: "PR" },
      { label: "Pernambuco", value: "PE" },
      { label: "Piauí", value: "PI" },
      { label: "Rio de Janeiro", value: "RJ" },
      { label: "Rio Grande do Norte", value: "RN" },
      { label: "Rio Grande do Sul", value: "RS" },
      { label: "Rondônia", value: "RO" },
      { label: "Roraima", value: "RR" },
      { label: "Santa Catarina", value: "SC" },
      { label: "São Paulo", value: "SP" },
      { label: "Sergipe", value: "SE" },
      { label: "Tocantins", value: "TO" },
    ],
    CA: [
      { label: "Alberta", value: "AB" },
      { label: "British Columbia", value: "BC" },
      { label: "Manitoba", value: "MB" },
      { label: "New Brunswick", value: "NB" },
      { label: "Newfoundland and Labrador", value: "NL" },
      { label: "Northwest Territories", value: "NT" },
      { label: "Nova Scotia", value: "NS" },
      { label: "Nunavut", value: "NU" },
      { label: "Ontario", value: "ON" },
      { label: "Prince Edward Island", value: "PE" },
      { label: "Quebec", value: "QC" },
      { label: "Saskatchewan", value: "SK" },
      { label: "Yukon Territories", value: "YT" },
    ],
    CN: [
      { label: "Anhui", value: "34" },
      { label: "Beijing", value: "11" },
      { label: "Chinese Taipei", value: "71" },
      { label: "Chongqing", value: "50" },
      { label: "Fujian", value: "35" },
      { label: "Gansu", value: "62" },
      { label: "Guangdong", value: "44" },
      { label: "Guangxi", value: "45" },
      { label: "Guizhou", value: "52" },
      { label: "Hainan", value: "46" },
      { label: "Hebei", value: "13" },
      { label: "Heilongjiang", value: "23" },
      { label: "Henan", value: "41" },
      { label: "Hong Kong", value: "91" },
      { label: "Hubei", value: "42" },
      { label: "Hunan", value: "43" },
      { label: "Jiangsu", value: "32" },
      { label: "Jiangxi", value: "36" },
      { label: "Jilin", value: "22" },
      { label: "Liaoning", value: "21" },
      { label: "Macao", value: "92" },
      { label: "Nei Mongol", value: "15" },
      { label: "Ningxia", value: "64" },
      { label: "Qinghai", value: "63" },
      { label: "Shaanxi", value: "61" },
      { label: "Shandong", value: "37" },
      { label: "Shanghai", value: "31" },
      { label: "Shanxi", value: "14" },
      { label: "Sichuan", value: "51" },
      { label: "Tianjin", value: "12" },
      { label: "Xinjiang", value: "65" },
      { label: "Xizang", value: "54" },
      { label: "Yunnan", value: "53" },
      { label: "Zhejiang", value: "33" },
    ],
    IE: [
      { label: "Carlow", value: "CW" },
      { label: "Cavan", value: "CN" },
      { label: "Clare", value: "CE" },
      { label: "Cork", value: "CO" },
      { label: "Donegal", value: "DL" },
      { label: "Dublin", value: "D" },
      { label: "Galway", value: "G" },
      { label: "Kerry", value: "KY" },
      { label: "Kildare", value: "KE" },
      { label: "Kilkenny", value: "KK" },
      { label: "Laois", value: "LS" },
      { label: "Leitrim", value: "LM" },
      { label: "Limerick", value: "LK" },
      { label: "Longford", value: "LD" },
      { label: "Louth", value: "LH" },
      { label: "Mayo", value: "MO" },
      { label: "Meath", value: "MH" },
      { label: "Monaghan", value: "MN" },
      { label: "Offaly", value: "OY" },
      { label: "Roscommon", value: "RN" },
      { label: "Sligo", value: "SO" },
      { label: "Tipperary", value: "TA" },
      { label: "Waterford", value: "WD" },
      { label: "Westmeath", value: "WH" },
      { label: "Wexford", value: "WX" },
      { label: "Wicklow", value: "WW" },
    ],
    IN: [
      { label: "Andaman and Nicobar Islands", value: "AN" },
      { label: "Andhra Pradesh", value: "AP" },
      { label: "Arunachal Pradesh", value: "AR" },
      { label: "Assam", value: "AS" },
      { label: "Bihar", value: "BR" },
      { label: "Chandigarh", value: "CH" },
      { label: "Chhattisgarh", value: "CT" },
      { label: "Dadra and Nagar Haveli", value: "DN" },
      { label: "Daman and Diu", value: "DD" },
      { label: "Delhi", value: "DL" },
      { label: "Goa", value: "GA" },
      { label: "Gujarat", value: "GJ" },
      { label: "Haryana", value: "HR" },
      { label: "Himachal Pradesh", value: "HP" },
      { label: "Jammu and Kashmir", value: "JK" },
      { label: "Jharkhand", value: "JH" },
      { label: "Karnataka", value: "KA" },
      { label: "Kerala", value: "KL" },
      { label: "Lakshadweep", value: "LD" },
      { label: "Madhya Pradesh", value: "MP" },
      { label: "Maharashtra", value: "MH" },
      { label: "Manipur", value: "MN" },
      { label: "Meghalaya", value: "ML" },
      { label: "Mizoram", value: "MZ" },
      { label: "Nagaland", value: "NL" },
      { label: "Odisha", value: "OR" },
      { label: "Puducherry", value: "PY" },
      { label: "Punjab", value: "PB" },
      { label: "Rajasthan", value: "RJ" },
      { label: "Sikkim", value: "SK" },
      { label: "Tamil Nadu", value: "TN" },
      { label: "Tripura", value: "TR" },
      { label: "Uttarakhand", value: "UT" },
      { label: "Uttar Pradesh", value: "UP" },
      { label: "West Bengal", value: "WB" },
    ],
    IT: [
      { label: "Agrigento", value: "AG" },
      { label: "Alessandria", value: "AL" },
      { label: "Ancona", value: "AN" },
      { label: "Aosta", value: "AO" },
      { label: "Arezzo", value: "AR" },
      { label: "Ascoli Piceno", value: "AP" },
      { label: "Asti", value: "AT" },
      { label: "Avellino", value: "AV" },
      { label: "Bari", value: "BA" },
      { label: "Barletta-Andria-Trani", value: "BT" },
      { label: "Belluno", value: "BL" },
      { label: "Benevento", value: "BN" },
      { label: "Bergamo", value: "BG" },
      { label: "Biella", value: "BI" },
      { label: "Bologna", value: "BO" },
      { label: "Bolzano", value: "BZ" },
      { label: "Brescia", value: "BS" },
      { label: "Brindisi", value: "BR" },
      { label: "Cagliari", value: "CA" },
      { label: "Caltanissetta", value: "CL" },
      { label: "Campobasso", value: "CB" },
      { label: "Carbonia-Iglesias", value: "CI" },
      { label: "Caserta", value: "CE" },
      { label: "Catania", value: "CT" },
      { label: "Catanzaro", value: "CZ" },
      { label: "Chieti", value: "CH" },
      { label: "Como", value: "CO" },
      { label: "Cosenza", value: "CS" },
      { label: "Cremona", value: "CR" },
      { label: "Crotone", value: "KR" },
      { label: "Cuneo", value: "CN" },
      { label: "Enna", value: "EN" },
      { label: "Fermo", value: "FM" },
      { label: "Ferrara", value: "FE" },
      { label: "Florence", value: "FI" },
      { label: "Foggia", value: "FG" },
      { label: "Forlì-Cesena", value: "FC" },
      { label: "Frosinone", value: "FR" },
      { label: "Genoa", value: "GE" },
      { label: "Gorizia", value: "GO" },
      { label: "Grosseto", value: "GR" },
      { label: "Imperia", value: "IM" },
      { label: "Isernia", value: "IS" },
      { label: "L'Aquila", value: "AQ" },
      { label: "La Spezia", value: "SP" },
      { label: "Latina", value: "LT" },
      { label: "Lecce", value: "LE" },
      { label: "Lecco", value: "LC" },
      { label: "Livorno", value: "LI" },
      { label: "Lodi", value: "LO" },
      { label: "Lucca", value: "LU" },
      { label: "Macerata", value: "MC" },
      { label: "Mantua", value: "MN" },
      { label: "Massa and Carrara", value: "MS" },
      { label: "Matera", value: "MT" },
      { label: "Medio Campidano", value: "VS" },
      { label: "Messina", value: "ME" },
      { label: "Milan", value: "MI" },
      { label: "Modena", value: "MO" },
      { label: "Monza and Brianza", value: "MB" },
      { label: "Naples", value: "NA" },
      { label: "Novara", value: "NO" },
      { label: "Nuoro", value: "NU" },
      { label: "Ogliastra", value: "OG" },
      { label: "Olbia-Tempio", value: "OT" },
      { label: "Oristano", value: "OR" },
      { label: "Padua", value: "PD" },
      { label: "Palermo", value: "PA" },
      { label: "Parma", value: "PR" },
      { label: "Pavia", value: "PV" },
      { label: "Perugia", value: "PG" },
      { label: "Pesaro and Urbino", value: "PU" },
      { label: "Pescara", value: "PE" },
      { label: "Piacenza", value: "PC" },
      { label: "Pisa", value: "PI" },
      { label: "Pistoia", value: "PT" },
      { label: "Pordenone", value: "PN" },
      { label: "Potenza", value: "PZ" },
      { label: "Prato", value: "PO" },
      { label: "Ragusa", value: "RG" },
      { label: "Ravenna", value: "RA" },
      { label: "Reggio Calabria", value: "RC" },
      { label: "Reggio Emilia", value: "RE" },
      { label: "Rieti", value: "RI" },
      { label: "Rimini", value: "RN" },
      { label: "Rome", value: "RM" },
      { label: "Rovigo", value: "RO" },
      { label: "Salerno", value: "SA" },
      { label: "Sassari", value: "SS" },
      { label: "Savona", value: "SV" },
      { label: "Siena", value: "SI" },
      { label: "Sondrio", value: "SO" },
      { label: "Syracuse", value: "SR" },
      { label: "Taranto", value: "TA" },
      { label: "Teramo", value: "TE" },
      { label: "Terni", value: "TR" },
      { label: "Trapani", value: "TP" },
      { label: "Trento", value: "TN" },
      { label: "Treviso", value: "TV" },
      { label: "Trieste", value: "TS" },
      { label: "Turin", value: "TO" },
      { label: "Udine", value: "UD" },
      { label: "Varese", value: "VA" },
      { label: "Venice", value: "VE" },
      { label: "Verbano-Cusio-Ossola", value: "VB" },
      { label: "Vercelli", value: "VC" },
      { label: "Verona", value: "VR" },
      { label: "Vibo Valentia", value: "VV" },
      { label: "Vicenza", value: "VI" },
      { label: "Viterbo", value: "VT" },
    ],
    MX: [
      { label: "Aguascalientes", value: "AG" },
      { label: "Baja California", value: "BC" },
      { label: "Baja California Sur", value: "BS" },
      { label: "Campeche", value: "CM" },
      { label: "Chiapas", value: "CS" },
      { label: "Chihuahua", value: "CH" },
      { label: "Coahuila", value: "CO" },
      { label: "Colima", value: "CL" },
      { label: "Durango", value: "DG" },
      { label: "Federal District", value: "DF" },
      { label: "Guanajuato", value: "GT" },
      { label: "Guerrero", value: "GR" },
      { label: "Hidalgo", value: "HG" },
      { label: "Jalisco", value: "JA" },
      { label: "Mexico State", value: "ME" },
      { label: "Michoacán", value: "MI" },
      { label: "Morelos", value: "MO" },
      { label: "Nayarit", value: "NA" },
      { label: "Nuevo León", value: "NL" },
      { label: "Oaxaca", value: "OA" },
      { label: "Puebla", value: "PB" },
      { label: "Querétaro", value: "QE" },
      { label: "Quintana Roo", value: "QR" },
      { label: "San Luis Potosí", value: "SL" },
      { label: "Sinaloa", value: "SI" },
      { label: "Sonora", value: "SO" },
      { label: "Tabasco", value: "TB" },
      { label: "Tamaulipas", value: "TM" },
      { label: "Tlaxcala", value: "TL" },
      { label: "Veracruz", value: "VE" },
      { label: "Yucatán", value: "YU" },
      { label: "Zacatecas", value: "ZA" },
    ],
    US: [
      { label: "Alabama", value: "AL" },
      { label: "Alaska", value: "AK" },
      { label: "Arizona", value: "AZ" },
      { label: "Arkansas", value: "AR" },
      { label: "California", value: "CA" },
      { label: "Colorado", value: "CO" },
      { label: "Connecticut", value: "CT" },
      { label: "Delaware", value: "DE" },
      { label: "District of Columbia", value: "DC" },
      { label: "Florida", value: "FL" },
      { label: "Georgia", value: "GA" },
      { label: "Hawaii", value: "HI" },
      { label: "Idaho", value: "ID" },
      { label: "Illinois", value: "IL" },
      { label: "Indiana", value: "IN" },
      { label: "Iowa", value: "IA" },
      { label: "Kansas", value: "KS" },
      { label: "Kentucky", value: "KY" },
      { label: "Louisiana", value: "LA" },
      { label: "Maine", value: "ME" },
      { label: "Maryland", value: "MD" },
      { label: "Massachusetts", value: "MA" },
      { label: "Michigan", value: "MI" },
      { label: "Minnesota", value: "MN" },
      { label: "Mississippi", value: "MS" },
      { label: "Missouri", value: "MO" },
      { label: "Montana", value: "MT" },
      { label: "Nebraska", value: "NE" },
      { label: "Nevada", value: "NV" },
      { label: "New Hampshire", value: "NH" },
      { label: "New Jersey", value: "NJ" },
      { label: "New Mexico", value: "NM" },
      { label: "New York", value: "NY" },
      { label: "North Carolina", value: "NC" },
      { label: "North Dakota", value: "ND" },
      { label: "Ohio", value: "OH" },
      { label: "Oklahoma", value: "OK" },
      { label: "Oregon", value: "OR" },
      { label: "Pennsylvania", value: "PA" },
      { label: "Rhode Island", value: "RI" },
      { label: "South Carolina", value: "SC" },
      { label: "South Dakota", value: "SD" },
      { label: "Tennessee", value: "TN" },
      { label: "Texas", value: "TX" },
      { label: "Utah", value: "UT" },
      { label: "Vermont", value: "VT" },
      { label: "Virginia", value: "VA" },
      { label: "Washington", value: "WA" },
      { label: "West Virginia", value: "WV" },
      { label: "Wisconsin", value: "WI" },
      { label: "Wyoming", value: "WY" },
    ],
  };

  get getShippingProvinceOptions() {
    return this.provinceMap[this.shippingAddress.country];
  }
  get getBillingProvinceOptions() {
    return this.provinceMap[this.billingAddress.country];
  }

  get getCountryOptions() {
    return this.countryOptions;
  }

  @wire(getObjectInfo, { objectApiName: ACCOUNT_OBJECT })
  handleObjectInfo({ error, data }) {
    if (data) {
      const rtis = data.recordTypeInfos;
      let brokerRecordTypeId = Object.keys(rtis).find(rti => rtis[rti].name === 'Broker');
      if (this.recordType == brokerRecordTypeId) {
        this.isBroker = true;
        this.isDisabledBroker = true;
      }
    }
  }

  handleChange(event){
    let attribute = event.target.fieldName; 
    if(attribute === 'Is_Agent__c'){
      this.isAgent = event.target.value;
    } else if(attribute === 'Is_Broker__c'){
      this.isBroker = event.target.value;
    }
  }

  handleBillingAddressChange(event) {
    this.billingAddress = event.detail;
    if(this.shippingDisabled === true){
        this.shippingAddress = this.billingAddress;
    }
  }

  handleShippingAddressChange(event) {
    this.shippingAddress = event.detail;
    if(this.billingDisabled === true){
        this.billingAddress = this.shippingAddress
    }
  }

  async copyShippingAddress(event) {
    if (!this.billingDisabled) {
      const result = await LightningConfirm.open({
        message: "Do you want to copy values from Shipping Addres?",
        label: 'Please Confirm'
      });
      if (result) {
        this.billingAddress = this.shippingAddress;
        this.billingDisabled = !this.billingDisabled;
      } else {
        this.template.querySelector(".disableBilling").checked = false;
      }
    } else {
      this.template.querySelector(".disableBilling").checked = false;
      this.billingDisabled = !this.billingDisabled;
    }
  }

  async copyBillingAddress(event) {
    if (!this.shippingDisabled) {
      const result = await LightningConfirm.open({
        message: "Do you want to copy values from Billing Addres?",
        label: 'Please Confirm',
      });
      if (result) {
        this.shippingAddress = this.billingAddress;
        this.shippingDisabled = !this.shippingDisabled;
      } else {
        this.template.querySelector(".disableShipping").checked = false;
      }
    } else {
      this.template.querySelector(".disableShipping").checked = false;
      this.shippingDisabled = !this.shippingDisabled;
    }
  }

  saveRecord(event){
    this.buttonName = event.target.dataset.name;
    const btn = this.template.querySelector(".slds-hidden");
    if (btn) {
      btn.click();
    }
  }

  handleSubmit(event){
    event.preventDefault();
    let fields = event.detail.fields;
    fields.BillingStreet = this.billingAddress.street;
    fields.BillingCity = this.billingAddress.city;
    fields.BillingPostalCode = this.billingAddress.postalCode;
    fields.BillingStateCode = this.billingAddress.province;
    fields.BillingCountryCode = this.billingAddress.country;
    fields.ShippingStreet = this.shippingAddress.street;
    fields.ShippingCity = this.shippingAddress.city;
    fields.ShippingPostalCode = this.shippingAddress.postalCode;
    fields.ShippingStateCode = this.shippingAddress.province;
    fields.ShippingCountryCode = this.shippingAddress.country;
    this.template.querySelector('lightning-record-edit-form').submit(fields); 
  }

  handleSuccess(event){
    console.log(this.buttonName)
    const evt = new ShowToastEvent({
        title: "Account Saved",
        variant: "success"
    });
    this.dispatchEvent(evt) 
    this.closeModal(event);
  }

  handleError(event){
    console.log(JSON.stringify(event.detail));
  }

  closeModal(event){
    let button = this.buttonName;
    let recordId = event.detail.id
    const closeModal = new CustomEvent('closemodal', {
        detail: {
            button: button,
            recordId : recordId
        },
    });
    this.dispatchEvent(closeModal);  
  } 
}
