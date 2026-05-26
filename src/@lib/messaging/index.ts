import { templateEngine } from "../../templates/engine";

// const twilio = require("twilio"); 
// import twilio from "twilio";



import SMTPTransport from "nodemailer/lib/smtp-transport";
import nodemailer from "nodemailer"

import { v4 as uuidv4 } from "uuid";
import { LOGO } from "../constants";
import { messagingConfig } from "../../@config";
// import twilio from "twilio";

interface SMSClient {
    send(message: Message): Promise<any>
}

export interface MailContent {
    from?: string | any;
    to?: string;
    replyTo?: string;
    subject: string;
    html: string;
    text?: string;
    attachment?: string[]
}



interface MailClient {
    send(message: MailContent): Promise<boolean>
}

interface Message {
    body?: string,
    from: string,
    to: string,
    type?: string
}

interface MailCredential {
    user: string
    pass: string
}


export class NodeMailerClient implements MailClient {
    client?: any

    constructor(user?: any) {
        if (this.client == undefined) {

            console.log(messagingConfig)
            let transporter = nodemailer.createTransport({
                host: messagingConfig?.smtpHost,
                port: parseInt(messagingConfig?.smtpPort as string),
                secure: false, // true for 465, false for other ports
                tls: {
                    rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : false,
                },
                // secure: true, // true for 465, false for other ports
                auth: {
                    user: user?.user || messagingConfig?.smtpUser, // generated ethereal user
                    pass: user?.pass || messagingConfig?.smtpPassword, // generated ethereal password
                },
            });
            this.client = transporter

        }
    }

    async send(message: MailContent): Promise<boolean> {
        if (this.client != undefined) {
            message.from = message.from || messagingConfig?.mailFrom || "HT Invoicing <support@htinvoicing.com>"
            const sent = await this.client.sendMail({ ...message, sender: "HT Invoicing" })
            console.log(sent.messageId)
            return sent.messageId != undefined

        }
        return false

    }
}

// export class TwilioSMSClient implements SMSClient {
//     client?: any
//     validPhone?: string
//     // setInstance: boolean = false
//     constructor() {
//         if (this.client == undefined) {
//             this.client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
//         }
//     }
//     async send(message: Message) {
//         return await this.client.messages.create(message).then(message => message.sid ? true : false)
//     }

//     async isValidPhone(phone: string) {
//         // const validatedPhone = await this.client?.lookups.v1.phoneNumbers(phone)
//         //     .fetch()
//         //     .then(function (phone_number) {
//         //         if (phone_number.phoneNumber) {
//         //             // console.log("phone", phone_number.nationalFormat)
//         //             return phone_number.phoneNumber
//         //         }
//         //     });
//         // const phoneNumber = parsePhoneNumber(phone)?.isValid()
//         // console.log(phoneNumber)
//         // if (phoneNumber) {
//         //     this.validPhone = phone
//         //     return this
//         // }
//         this.validPhone = phone

//         return this

//     }
// }

export const sendSMSUsing = async (client: SMSClient, message: Message) => await client.send(message).then(sent_or_not => sent_or_not)
export const sendMailUsing = async (client: MailClient, message: MailContent) => await client.send(message).then(sent_or_not => sent_or_not)
export const withTemplate = (content: string) => {
    let logo = LOGO
    return templateEngine.renderInline(
        'defaultEmailTemplate',
        messagingConfig?.defaultEmailTemplate || '',
        { logo, content }
    );
}
